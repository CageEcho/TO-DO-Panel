#!/usr/bin/env node
'use strict';

// 用合成语音做一次真实解码和推理。不读取用户音频，也不算作已经接通 Grok。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  selectTranscriber,
  buildInvocation,
  finalizeTranscriptionOutput,
} = require('./transcribe-adapter');

const root = path.join(__dirname, '..');
const helperRoot = path.join(root, 'helpers', 'mac');
const runtime = process.env.TODO_PANEL_PRIVATE_RUNTIME || path.join(os.tmpdir(), 'todo-panel-transcribe-smoke');
const audio = path.join(runtime, 'synthetic.wav');
const output = path.join(runtime, 'synthetic.txt');
const model = process.env.TODO_PANEL_WHISPER_MODEL || 'tiny';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function synthesize(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (process.platform === 'darwin') {
    const said = spawnSync('say', [
      '-o', target,
      '--file-format=WAVE',
      '--data-format=LEI16@16000',
      'This is a synthetic transcription check.',
    ], { stdio: 'inherit' });
    if (said.status === 0 && fs.existsSync(target) && fs.statSync(target).size > 44) return;
  }
  const spoken = spawnSync('espeak-ng', ['-w', target, '-s', '140', 'This is a synthetic transcription check.'], { stdio: 'inherit' });
  if (spoken.status === 0 && fs.existsSync(target) && fs.statSync(target).size > 44) return;
  fail('无法在本机生成合成语音。');
}

function main() {
  synthesize(audio);
  if (process.exitCode) return;
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (uv.status !== 0) {
    fail('uv 不在 PATH 上。');
    return;
  }
  const selection = selectTranscriber({
    env: {},
    lookup: (name) => (name === 'uv' ? 'uv' : ''),
    helperRoot,
  });
  if (selection.reason !== 'faster_whisper_uv') {
    fail(`未选中 faster-whisper：${selection.reason}`);
    return;
  }
  const options = {
    env: process.env,
    home: os.homedir(),
    platform: process.platform,
    privateRuntime: runtime,
    model,
  };
  const sample = buildInvocation(selection, audio, output, options);
  if (sample.env.UV_PROJECT_ENVIRONMENT.includes(`${path.sep}Applications${path.sep}`)) {
    fail('虚拟环境指向了签名应用目录。');
    return;
  }
  const childEnv = { ...process.env, ...sample.env, TODO_PANEL_WHISPER_MODEL: model };
  const synced = spawnSync(selection.command, ['sync', '--frozen', '--project', path.join(helperRoot, 'transcribe')], {
    stdio: 'inherit',
    env: childEnv,
    timeout: 600000,
  });
  if (!synced || synced.status !== 0) {
    fail('uv sync --frozen 失败。');
    return;
  }
  const invocation = buildInvocation(selection, audio, output, options);
  const ran = spawnSync(invocation.command, invocation.args, {
    stdio: 'inherit',
    env: childEnv,
    timeout: 600000,
  });
  if (!ran || ran.status !== 0 || !finalizeTranscriptionOutput(invocation, fs)) {
    fail('合成语音推理没有写出文本。');
    return;
  }
  const text = fs.readFileSync(output, 'utf8');
  if (!/synthetic|check|transcription/i.test(text)) {
    fail(`推理结果不像合成语句：${JSON.stringify(text)}`);
    return;
  }
  const av = spawnSync(path.join(sample.env.UV_PROJECT_ENVIRONMENT, 'bin', 'python'), ['-c', 'import av; print(av.__version__)'], { encoding: 'utf8' });
  console.log(JSON.stringify({
    ok: true,
    model,
    av: (av.stdout || '').trim(),
    transcript: text.trim(),
    venv: sample.env.UV_PROJECT_ENVIRONMENT,
    modelCache: sample.env.HF_HOME || process.env.HF_HOME || '',
  }));
}

main();
