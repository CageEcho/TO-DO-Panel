#!/usr/bin/env node
'use strict';

// 只在本机授权根目录内递归列出文本和录音，并把脱敏文本写到调用者指定的 work-materials。
// 不读取其他目录，不上传音频。没有本地转写程序时只报告原因。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareWorkMaterials } = require('../main-services');
const {
  selectTranscriber,
  buildInvocation,
  finalizeTranscriptionOutput,
} = require('./transcribe-adapter');

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

function resolveHelperRoot(scriptDir) {
  const candidates = [
    process.env.TODO_PANEL_HELPER_ROOT,
    path.resolve(scriptDir, '../helpers/mac'),
    path.resolve(scriptDir, '..'),
    path.resolve(scriptDir, '../../work-helper'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'transcribe', 'transcribe.py'))) || '';
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
  const helperRoot = resolveHelperRoot(__dirname);
  const selection = selectTranscriber({
    env: process.env,
    lookup: (name) => lookupLocal([name]),
    helperRoot,
  });
  let runner;
  if (args.transcribe && selection.ok && selection.kind === 'faster-whisper-uv') {
    const synced = spawnSync(selection.command, ['sync', '--project', path.join(helperRoot, 'transcribe')], {
      stdio: 'inherit',
      timeout: 600000,
    });
    if (!synced || synced.status !== 0) {
      console.error('transcriber_deps_unavailable');
      process.exitCode = 2;
      return;
    }
  }
  if (args.transcribe && selection.ok) {
    runner = ({ input, output }) => {
      const invocation = buildInvocation(selection, input, output);
      const result = spawnSync(invocation.command, invocation.args, {
        stdio: 'ignore',
        timeout: 120000,
        env: { ...process.env, ...(invocation.env || {}) },
      });
      if (!result || result.status !== 0) return { ok: false, reason: 'transcriber_failed' };
      return finalizeTranscriptionOutput(invocation, fs)
        ? { ok: true }
        : { ok: false, reason: 'transcript_missing' };
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
  if (args.transcribe && !selection.ok) {
    console.error(selection.reason);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { readArgs, lookupLocal, resolveHelperRoot };
