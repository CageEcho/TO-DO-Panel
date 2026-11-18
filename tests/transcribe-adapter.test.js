const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  selectTranscriber,
  buildInvocation,
  isTwoPositionalContract,
  finalizeTranscriptionOutput,
} = require('../scripts/transcribe-adapter');
const { stageWorkHelper } = require('../scripts/pack-work-helper');

const helper = path.join(__dirname, '..', 'helpers', 'mac');

test('native whisper commands are not called with only audio and output paths', () => {
  const cpp = buildInvocation(
    { ok: true, kind: 'whisper-cpp', command: '/usr/local/bin/whisper-cli' },
    '/tmp/clip.m4a',
    '/tmp/out/clip.txt',
  );
  assert.deepEqual(cpp.args, ['-f', '/tmp/clip.m4a', '-otxt', '-of', '/tmp/out/clip']);
  assert.equal(isTwoPositionalContract(cpp), false);
  assert.notDeepEqual(cpp.args, ['/tmp/clip.m4a', '/tmp/out/clip.txt']);

  const openai = buildInvocation(
    { ok: true, kind: 'openai-whisper', command: '/usr/local/bin/whisper' },
    '/tmp/clip.m4a',
    '/tmp/out/wanted.txt',
  );
  assert.deepEqual(openai.args.slice(1), [
    '--model', 'small', '--output_format', 'txt', '--output_dir', '/tmp/out', '--device', 'cpu',
  ]);
  assert.equal(openai.args[0], '/tmp/clip.m4a');
  assert.equal(isTwoPositionalContract(openai), false);
  assert.equal(openai.produced, '/tmp/out/clip.txt');

  const explicitCli = selectTranscriber({
    env: { TODO_PANEL_LOCAL_TRANSCRIBE: '/opt/bin/whisper-cli' },
  });
  assert.equal(explicitCli.kind, 'whisper-cpp');
  const explicitWhisper = selectTranscriber({
    env: { TODO_PANEL_LOCAL_TRANSCRIBE: '/opt/bin/whisper' },
  });
  assert.equal(explicitWhisper.kind, 'openai-whisper');
});

test('uv faster-whisper is selected when whisper is absent and uses the two-path wrapper', () => {
  const selected = selectTranscriber({
    lookup: (name) => (name === 'uv' ? '/usr/bin/uv' : ''),
    helperRoot: helper,
  });
  assert.equal(selected.reason, 'faster_whisper_uv');
  const plan = buildInvocation(selected, '/tmp/clip.m4a', '/tmp/out/clip.txt');
  assert.equal(plan.command, '/usr/bin/uv');
  assert.deepEqual(plan.args.slice(0, 6), [
    'run', '--frozen', '--project', path.join(helper, 'transcribe'), 'python', path.join(helper, 'transcribe', 'transcribe.py'),
  ]);
  assert.deepEqual(plan.args.slice(6), [
    '/tmp/clip.m4a', '/tmp/out/clip.txt', '--model', 'small', '--device', 'cpu', '--compute-type', 'int8',
  ]);
  assert.equal(plan.env.HF_HUB_DISABLE_TELEMETRY, '1');
  assert.equal(plan.env.UV_PROJECT_ENVIRONMENT.includes(`${path.sep}Applications${path.sep}`), false);
  assert.match(plan.env.UV_PROJECT_ENVIRONMENT, /local-transcribe[/\\]venv$/);
  const kept = buildInvocation(selected, '/tmp/clip.m4a', '/tmp/out/clip.txt', {
    home: '/Users/example',
    platform: 'darwin',
    env: { HF_HOME: '/Users/example/.cache/huggingface' },
  });
  assert.equal(kept.env.HF_HOME, undefined);
  assert.equal(selectTranscriber({
    env: { TODO_PANEL_LOCAL_TRANSCRIBE: 'https://dashscope.aliyuncs.com/asr' },
    lookup: () => '/usr/bin/uv',
    helperRoot: helper,
  }).reason, 'refusing_cloud_transcriber');
  assert.equal(selectTranscriber({ lookup: () => '', helperRoot: helper }).reason, 'local_transcriber_missing');
});

test('an explicit two-arg wrapper stays two-arg and native output files are moved', () => {
  const wrapper = buildInvocation(
    selectTranscriber({ env: { TODO_PANEL_LOCAL_TRANSCRIBE: '/opt/bin/my-transcribe' } }),
    '/tmp/a.wav',
    '/tmp/b.txt',
  );
  assert.deepEqual(wrapper.args, ['/tmp/a.wav', '/tmp/b.txt']);
  assert.equal(isTwoPositionalContract(wrapper), true);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-move-'));
  const produced = path.join(directory, 'clip.txt');
  const wanted = path.join(directory, 'wanted.txt');
  fs.writeFileSync(produced, 'synthetic transcript\n');
  const plan = buildInvocation(
    { ok: true, kind: 'openai-whisper', command: 'whisper' },
    path.join(directory, 'clip.m4a'),
    wanted,
  );
  assert.equal(finalizeTranscriptionOutput(plan, fs), true);
  assert.equal(fs.readFileSync(wanted, 'utf8'), 'synthetic transcript\n');
  assert.equal(fs.existsSync(produced), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('uv.lock pins PyAV 18.1.0 so faster-whisper 1.2.1 can open audio', () => {
  const lock = fs.readFileSync(path.join(helper, 'transcribe', 'uv.lock'), 'utf8');
  const av = lock.split('\n\n').find((block) => block.startsWith('[[package]]\nname = "av"') || block.includes('\nname = "av"\n'));
  assert.match(av, /version = "18\.1\.0"/);
  assert.equal(/version = "19\./.test(av), false);
  const project = fs.readFileSync(path.join(helper, 'transcribe', 'pyproject.toml'), 'utf8');
  assert.match(project, /faster-whisper==1\.2\.1/);
  assert.match(project, /av==18\.1\.0/);
});

test('helper stage contains the adapter, import CLI, and checksums without model weights', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-helper-'));
  stageWorkHelper(directory);
  assert.equal(fs.existsSync(path.join(directory, 'scripts', 'work-source-prepare.js')), true);
  assert.equal(fs.existsSync(path.join(directory, 'scripts', 'grok-work-import.js')), true);
  assert.equal(fs.existsSync(path.join(directory, 'transcribe', 'transcribe.py')), true);
  const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  assert.equal(sums.length > 5, true);
  sums.forEach((line) => {
    const [hash, relative] = line.split(/ {2}/);
    const file = path.join(directory, relative);
    const actual = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(actual, hash, relative);
  });
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.bin')), false);
  const python = spawnSync('python3', [path.join(directory, 'transcribe', 'transcribe.py'), '/no/such-audio.wav', path.join(directory, 'out.txt')], { encoding: 'utf8' });
  assert.equal(python.status, 2);
  assert.equal(fs.existsSync(path.join(directory, 'out.txt')), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
