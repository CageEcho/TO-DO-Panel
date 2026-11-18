#!/usr/bin/env node
'use strict';

// 只在本机授权根目录内递归列出文本和录音，并把脱敏文本写到调用者指定的 work-materials。
// 不读取其他目录，不上传音频。没有本地转写程序时只报告原因。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareWorkMaterials, probeLocalTranscriber } = require('../main-services');

function readArgs(argv) {
  const args = { root: '', out: '', transcribe: false, maxAudioBytes: 32 * 1024 * 1024, watermark: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (/^--?(api[-_]?key|token|secret|password)\b/i.test(arg)) return { error: 'secret_on_argv' };
    if (arg === '--root') args.root = argv[++index] || '';
    else if (arg === '--out') args.out = argv[++index] || '';
    else if (arg === '--transcribe') args.transcribe = true;
    else if (arg === '--max-audio-bytes') args.maxAudioBytes = Number(argv[++index] || 0);
    else if (arg === '--watermark') {
      try {
        const parsed = JSON.parse(fs.readFileSync(argv[++index] || '', 'utf8'));
        args.watermark = Array.isArray(parsed.hashes) ? parsed.hashes : [];
      } catch (error) {
        return { error: 'watermark' };
      }
    } else if (arg.startsWith('--')) return { error: 'unknown_arg' };
  }
  return args;
}

function lookupLocal(names) {
  for (const name of names) {
    if (!name || name.includes('://')) continue;
    if (path.isAbsolute(name)) return fs.existsSync(name) ? name : '';
    for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.error || !args.root || !args.out) {
    console.error(args.error === 'secret_on_argv'
      ? '不要把密钥放在命令行参数里。'
      : '用法：node scripts/work-source-prepare.js --root <WORK_ROOT> --out <目录>/work-materials [--transcribe]');
    process.exitCode = 2;
    return;
  }
  const probe = probeLocalTranscriber({
    env: process.env,
    lookup: (names) => lookupLocal(names),
  });
  let runner;
  if (args.transcribe && probe.ok) {
    const command = lookupLocal([process.env.TODO_PANEL_LOCAL_TRANSCRIBE, 'whisper-cli', 'whisper'].filter(Boolean));
    runner = ({ input, output }) => {
      const result = spawnSync(command, [input, output], { stdio: 'ignore', timeout: 120000 });
      return { ok: result.status === 0 && fs.existsSync(output), reason: result.status === 0 ? '' : 'transcriber_failed' };
    };
  }
  const prepared = prepareWorkMaterials({
    root: args.root,
    outDir: args.out,
    knownAudioHashes: args.watermark,
    maxAudioBytes: Number.isInteger(args.maxAudioBytes) && args.maxAudioBytes > 0 ? args.maxAudioBytes : undefined,
    runner,
    env: process.env,
    lookup: (names) => lookupLocal(names),
    home: process.env.HOME || '',
  });
  if (!prepared.ok) {
    console.error(prepared.error || 'prepare_failed');
    process.exitCode = 2;
    return;
  }
  const summary = {
    ok: true,
    rootLabel: prepared.manifest.rootLabel,
    files: prepared.manifest.files.length,
    skipped: prepared.manifest.skipped.length,
    transcriber: prepared.manifest.transcriber.reason,
    audioReady: prepared.manifest.files.filter((file) => file.transcription && file.transcription.state === 'ready').length,
    audioPending: prepared.manifest.files.filter((file) => file.kind === 'audio' && file.transcription && file.transcription.state !== 'ready' && file.transcription.state !== 'duplicate').length,
  };
  console.log(JSON.stringify(summary));
  if (args.transcribe && !probe.ok) {
    console.error(probe.reason);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { readArgs, lookupLocal };
