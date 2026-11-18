const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  inspectWorkRoot,
  prepareWorkMaterials,
  probeLocalTranscriber,
} = require('../main-services');

function makeRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-root-'));
  const root = path.join(directory, 'source');
  fs.mkdirSync(path.join(root, 'recordings', 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes.txt'), 'synthetic note');
  fs.writeFileSync(path.join(root, 'recordings', 'a', 'clip.m4a'), 'audio-a');
  fs.writeFileSync(path.join(root, 'recordings', 'a', 'clip-copy.m4a'), 'audio-a');
  fs.writeFileSync(path.join(root, 'recordings', 'huge.m4a'), '0123456789abcdef');
  fs.writeFileSync(path.join(root, 'credentials.json'), 'SECRET_VALUE');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET_ENV');
  fs.writeFileSync(path.join(root, 'tool.sh'), 'echo no');
  fs.chmodSync(path.join(root, 'tool.sh'), 0o755);
  fs.writeFileSync(path.join(directory, 'outside.txt'), 'outside');
  try {
    fs.symlinkSync(path.join(directory, 'outside.txt'), path.join(root, 'escape.txt'));
    fs.symlinkSync(directory, path.join(root, 'escape-dir'));
  } catch (error) {
    // Some filesystems disallow symlinks; the assertions below allow that.
  }
  return { directory, root };
}

test('work root recursion stays inside realpath and skips secrets, executables, and oversized audio', () => {
  const { directory, root } = makeRoot();
  const listed = inspectWorkRoot(root, { home: directory, maxAudioBytes: 10, maxBytes: 1024 });
  assert.equal(listed.ok, true);
  const paths = listed.files.map((file) => file.relativePath);
  assert.ok(paths.includes('notes.txt'));
  assert.ok(paths.includes('recordings/a/clip.m4a'));
  assert.equal(paths.includes('escape.txt'), false);
  assert.equal(paths.some((item) => item.startsWith('escape-dir/')), false);
  assert.equal(listed.files.some((file) => file.relativePath === 'credentials.json'), false);
  assert.equal(listed.files.some((file) => file.relativePath === '.env'), false);
  assert.equal(listed.files.some((file) => file.relativePath === 'tool.sh'), false);
  assert.equal(listed.files.some((file) => file.relativePath === 'recordings/huge.m4a'), false);
  assert.equal(listed.skipped.some((item) => item.reason === 'escape' || item.reason === 'symlink_directory'), true);
  assert.equal(listed.skipped.some((item) => item.reason === 'credential'), true);
  assert.equal(listed.skipped.some((item) => item.reason === 'hidden_or_unsafe'), true);
  assert.equal(listed.skipped.some((item) => item.reason === 'executable'), true);
  assert.equal(listed.skipped.some((item) => item.reason === 'too_large'), true);
  const serialized = JSON.stringify(listed);
  assert.equal(serialized.includes('SECRET_VALUE'), false);
  assert.equal(serialized.includes('SECRET_ENV'), false);
  const clips = listed.files.filter((file) => file.relativePath.includes('clip'));
  assert.equal(clips.length, 2);
  assert.equal(clips.filter((file) => file.duplicate).length, 1);
  assert.equal(clips.find((file) => file.duplicate).transcription.reason, 'audio_watermark');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('local transcription is explicit, and duplicate audio stays behind the watermark', () => {
  const { directory, root } = makeRoot();
  const out = path.join(directory, 'work-materials');
  assert.equal(probeLocalTranscriber({ lookup: () => '' }).reason, 'local_transcriber_missing');
  assert.equal(probeLocalTranscriber({
    env: { TODO_PANEL_LOCAL_TRANSCRIBE: 'https://dashscope.aliyuncs.com/asr' },
    lookup: () => 'whisper',
  }).reason, 'refusing_cloud_transcriber');
  const missing = prepareWorkMaterials({ root, outDir: out, home: directory, maxAudioBytes: 10 });
  assert.equal(missing.ok, true);
  const audio = missing.manifest.files.find((file) => file.kind === 'audio' && !file.duplicate);
  assert.equal(audio.transcription.reason, 'local_transcriber_missing');
  assert.equal(fs.existsSync(path.join(out, 'recordings')), false);
  assert.equal(JSON.stringify(missing.manifest).includes(root), false);
  let calls = 0;
  const ready = prepareWorkMaterials({
    root,
    outDir: out,
    home: directory,
    maxAudioBytes: 10,
    runner({ input, output }) {
      calls += 1;
      assert.equal(fs.readFileSync(input, 'utf8'), 'audio-a');
      fs.writeFileSync(output, 'synthetic transcript');
      return { ok: true };
    },
  });
  assert.equal(calls, 1, 'the duplicate copy is not transcribed again');
  const transcribed = ready.manifest.files.filter((file) => file.transcription && file.transcription.state === 'ready');
  assert.equal(transcribed.length, 1);
  assert.equal(fs.readFileSync(path.join(out, transcribed[0].textFile), 'utf8'), 'synthetic transcript');
  const again = prepareWorkMaterials({
    root,
    outDir: out,
    home: directory,
    maxAudioBytes: 10,
    knownAudioHashes: [audio.sha256],
    runner() { throw new Error('watermarked audio must not be transcribed'); },
  });
  assert.equal(again.manifest.files.find((file) => file.relativePath === 'recordings/a/clip.m4a').transcription.state, 'duplicate');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('prepare command reports a missing local transcriber without uploading audio', () => {
  const { directory, root } = makeRoot();
  const out = path.join(directory, 'work-materials');
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'work-source-prepare.js'),
    '--root', root,
    '--out', out,
    '--transcribe',
    '--max-audio-bytes', '10',
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', TODO_PANEL_LOCAL_TRANSCRIBE: '' },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /local_transcriber_missing/);
  assert.equal(result.stdout.includes(root), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.rootLabel, 'private-local-root');
  assert.equal(manifest.files.some((file) => file.relativePath === 'recordings/a/clip.m4a'), true);
  assert.equal(fs.readdirSync(out).some((name) => name.endsWith('.m4a')), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
