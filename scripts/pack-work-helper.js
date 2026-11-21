#!/usr/bin/env node
'use strict';

// 组装可单独拷到 Mac 上的助手目录。不下载模型，不包含真实音频。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const stage = path.join(root, 'build', 'work-helper-stage');
const copies = [
  ['main-services.js', 'main-services.js'],
  ['renderer/work-domain.js', 'renderer/work-domain.js'],
  ['scripts/work-source-prepare.js', 'scripts/work-source-prepare.js'],
  ['scripts/grok-work-import.js', 'scripts/grok-work-import.js'],
  ['scripts/transcribe-adapter.js', 'scripts/transcribe-adapter.js'],
  ['scripts/grok-work-adapter.js', 'scripts/grok-work-adapter.js'],
  ['helpers/mac/README.md', 'README.md'],
  ['helpers/mac/transcribe/pyproject.toml', 'transcribe/pyproject.toml'],
  ['helpers/mac/transcribe/uv.lock', 'transcribe/uv.lock'],
  ['helpers/mac/transcribe/transcribe.py', 'transcribe/transcribe.py'],
];

function stageWorkHelper(destination = stage) {
  fs.rmSync(destination, { recursive: true, force: true });
  copies.forEach(([from, to]) => {
    const target = path.join(destination, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, from), target);
  });
  const lines = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name !== 'SHA256SUMS') {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
          lines.push(`${hash}  ${path.relative(destination, full).split(path.sep).join('/')}`);
        }
      });
  };
  walk(destination);
  fs.writeFileSync(path.join(destination, 'SHA256SUMS'), `${lines.join('\n')}\n`);
  return destination;
}

function zipDirectory(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { force: true });
  const result = spawnSync('zip', ['-r', '-X', destination, '.'], { cwd: source, stdio: 'inherit' });
  if (!result || result.status !== 0) throw new Error('zip_failed');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  fs.writeFileSync(`${destination}.sha256`, `${hash}  ${path.basename(destination)}\n`);
  return { file: destination, sha256: hash };
}

function main() {
  const zipIndex = process.argv.indexOf('--zip');
  const staged = stageWorkHelper();
  if (zipIndex === -1) return;
  const version = require(path.join(root, 'package.json')).version;
  const outDir = path.resolve(process.argv[zipIndex + 1] || path.join(root, 'helper-dist'));
  const zip = path.join(outDir, `TO-DO-Panel-Work-${version}-mac-work-helper.zip`);
  const packed = zipDirectory(staged, zip);
  console.log(JSON.stringify({ ok: true, file: packed.file, sha256: packed.sha256 }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.message ? error.message : 'pack_failed');
    process.exitCode = 1;
  }
}

module.exports = { stageWorkHelper, copies };
