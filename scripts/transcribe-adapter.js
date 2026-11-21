'use strict';

// 选择本机转写程序并生成它真正接受的参数。
// whisper.cpp 与 openai-whisper 都不是「音频路径 + 文本路径」两个位置参数。
// 只有本仓库的 faster-whisper 包装和显式 two-arg 包装使用这个契约。

const path = require('node:path');

const CLOUD_TRANSCRIBER = /(api\.openai|api\.anthropic|dashscope|bailian|aliyuncs|generativelanguage\.googleapis|https?:\/\/)/i;
const KINDS = new Set(['two-arg', 'whisper-cpp', 'openai-whisper', 'faster-whisper-uv']);

function commandBase(command) {
  return path.basename(String(command || '')).toLowerCase().replace(/\.exe$/, '');
}

function kindForCommand(command) {
  const base = commandBase(command);
  if (base === 'whisper-cli' || base === 'main') return 'whisper-cpp';
  if (base === 'whisper') return 'openai-whisper';
  return 'two-arg';
}

function selectTranscriber({ env = {}, lookup = () => '', helperRoot = '' } = {}) {
  const requested = typeof env.TODO_PANEL_LOCAL_TRANSCRIBE === 'string' ? env.TODO_PANEL_LOCAL_TRANSCRIBE.trim() : '';
  if (requested && CLOUD_TRANSCRIBER.test(requested)) {
    return { ok: false, reason: 'refusing_cloud_transcriber' };
  }
  const forced = typeof env.TODO_PANEL_TRANSCRIBE_KIND === 'string' ? env.TODO_PANEL_TRANSCRIBE_KIND.trim() : '';
  if (forced && !KINDS.has(forced)) return { ok: false, reason: 'unknown_transcriber_kind' };
  if (requested) {
    const kind = forced || kindForCommand(requested);
    return {
      ok: true,
      kind,
      command: requested,
      helperRoot: kind === 'faster-whisper-uv' ? helperRoot : '',
      reason: kind === 'two-arg' ? 'explicit_wrapper' : kind,
    };
  }
  const uv = lookup('uv');
  if (uv && helperRoot) {
    return { ok: true, kind: 'faster-whisper-uv', command: uv, helperRoot, reason: 'faster_whisper_uv' };
  }
  const whisperCli = lookup('whisper-cli');
  if (whisperCli) return { ok: true, kind: 'whisper-cpp', command: whisperCli, reason: 'whisper_cpp' };
  const whisper = lookup('whisper');
  if (whisper) return { ok: true, kind: 'openai-whisper', command: whisper, reason: 'openai_whisper' };
  return { ok: false, reason: 'local_transcriber_missing' };
}

function privateRuntimeRoot({ env = {}, home = '', platform = 'darwin', privateRuntime = '' } = {}) {
  if (privateRuntime) return privateRuntime;
  if (env.TODO_PANEL_PRIVATE_RUNTIME) return env.TODO_PANEL_PRIVATE_RUNTIME;
  if (platform === 'win32') return path.join(env.APPDATA || home, 'TO-DO Panel Work', 'local-transcribe');
  if (platform === 'linux') return path.join(home, '.local', 'share', 'to-do-panel-work', 'local-transcribe');
  return path.join(home, 'Library', 'Application Support', 'TO-DO Panel Work', 'local-transcribe');
}

function fasterWhisperRuntimeEnv(runtime, inherited = {}) {
  const env = {
    UV_PROJECT_ENVIRONMENT: path.join(runtime, 'venv'),
    UV_CACHE_DIR: path.join(runtime, 'uv-cache'),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: path.join(runtime, 'pyc'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_ENABLE_HF_TRANSFER: '0',
  };
  if (!inherited.HF_HOME) {
    env.HF_HOME = path.join(runtime, 'model-cache');
    env.HUGGINGFACE_HUB_CACHE = path.join(runtime, 'model-cache', 'hub');
  }
  return env;
}

function buildInvocation(selection, input, output, options = {}) {
  if (!selection || selection.ok !== true) return null;
  const model = options.model || 'small';
  if (selection.kind === 'whisper-cpp') {
    const base = output.replace(/\.txt$/i, '');
    const args = [];
    if (options.modelPath) args.push('-m', options.modelPath);
    args.push('-f', input, '-otxt', '-of', base);
    return {
      command: selection.command,
      args,
      output,
      produced: `${base}.txt`,
      kind: selection.kind,
    };
  }
  if (selection.kind === 'openai-whisper') {
    const directory = path.dirname(output);
    const produced = path.join(directory, `${path.basename(input, path.extname(input))}.txt`);
    return {
      command: selection.command,
      args: [input, '--model', model, '--output_format', 'txt', '--output_dir', directory, '--device', 'cpu'],
      output,
      produced,
      kind: selection.kind,
    };
  }
  if (selection.kind === 'faster-whisper-uv') {
    const project = path.join(selection.helperRoot, 'transcribe');
    const runtime = privateRuntimeRoot(options);
    return {
      command: selection.command,
      args: [
        'run', '--frozen', '--python', '3.12', '--project', project,
        'python', path.join(project, 'transcribe.py'),
        input, output,
        '--model', model,
        '--device', 'cpu',
        '--compute-type', 'int8',
      ],
      output,
      produced: output,
      kind: selection.kind,
      runtime,
      env: fasterWhisperRuntimeEnv(runtime, options.env || {}),
    };
  }
  return {
    command: selection.command,
    args: [input, output],
    output,
    produced: output,
    kind: 'two-arg',
  };
}

function uvSyncArgs(helperRoot) {
  return ['sync', '--frozen', '--python', '3.12', '--project', path.join(helperRoot, 'transcribe')];
}

function isTwoPositionalContract(invocation) {
  return Boolean(invocation && invocation.kind === 'two-arg' && invocation.args.length === 2);
}

function finalizeTranscriptionOutput(invocation, fsImpl) {
  if (!invocation || !fsImpl.existsSync(invocation.produced)) return false;
  if (path.resolve(invocation.produced) !== path.resolve(invocation.output)) {
    fsImpl.renameSync(invocation.produced, invocation.output);
  }
  return fsImpl.existsSync(invocation.output);
}

module.exports = {
  selectTranscriber,
  privateRuntimeRoot,
  buildInvocation,
  uvSyncArgs,
  kindForCommand,
  isTwoPositionalContract,
  finalizeTranscriptionOutput,
};
