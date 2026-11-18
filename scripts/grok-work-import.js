#!/usr/bin/env node
'use strict';

// 把已经整理好的 grok-work/v1 JSON 原子写入 todo-inbox。
// 不联网，不读取模型密钥，不扫描磁盘。真正的去重和合并由应用完成。

const fs = require('node:fs');
const path = require('node:path');
const { isWorkImportPayload, mergeWorkImport, createEmptyWorkState } = require('../renderer/work-domain');
const { isOfficialPanelDataPath, writeAtomicFile } = require('../main-services');

function readArgs(argv) {
  const args = { dryRun: false, inbox: '', file: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (/^--?(api[-_]?key|token|secret|password)\b/i.test(arg)) {
      return { error: 'secret_on_argv' };
    }
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--inbox') args.inbox = argv[++index] || '';
    else if (arg === '--file') args.file = argv[++index] || '';
    else if (arg === '--app-data') args.appData = argv[++index] || '';
    else if (arg.startsWith('--')) return { error: `unknown_arg:${arg.slice(0, 40)}` };
  }
  return args;
}

function planInboxWrite({ inboxDir, payload, appData, now = new Date() } = {}) {
  let inbox;
  try {
    inbox = path.resolve(String(inboxDir || ''));
  } catch (error) {
    return { ok: false, error: 'inbox_path' };
  }
  if (path.basename(inbox) !== 'todo-inbox') return { ok: false, error: 'inbox_name' };
  if (appData && isOfficialPanelDataPath(inbox, appData)) return { ok: false, error: 'official_data_dir' };
  if (!isWorkImportPayload(payload)) return { ok: false, error: 'schema' };
  const preview = mergeWorkImport(createEmptyWorkState(), payload, { now: now.getTime() });
  if (preview.error) return { ok: false, error: preview.error };
  const stamp = (now instanceof Date ? now : new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return {
    ok: true,
    inbox,
    fileName: `grok-work-${stamp}.json`,
    preview: {
      imported: preview.imported.length,
      skipped: preview.skipped.length,
      warnings: preview.warnings.length,
      ids: preview.imported.map((item) => item.id),
      reasons: preview.skipped.map((item) => item.reason),
    },
  };
}

function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error === 'secret_on_argv' ? '不要把密钥放在命令行参数里。' : '无法识别参数。用法：node scripts/grok-work-import.js --inbox <todo-inbox> --file <json> [--dry-run]');
    process.exitCode = 2;
    return;
  }
  if (!args.inbox || !args.file) {
    console.error('需要 --inbox 和 --file。密钥只能放在环境中，本脚本也不会读取。');
    process.exitCode = 2;
    return;
  }
  let payload;
  let raw;
  try {
    raw = fs.readFileSync(args.file);
    payload = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    console.error('无法读取或解析 JSON 文件。');
    process.exitCode = 2;
    return;
  }
  if (raw.length > 1024 * 1024) {
    console.error('文件超过 1 MB，未写入收件箱。');
    process.exitCode = 2;
    return;
  }
  const plan = planInboxWrite({ inboxDir: args.inbox, payload, appData: args.appData, now: new Date() });
  if (!plan.ok) {
    console.error(`未写入：${plan.error}`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({ ok: true, dryRun: args.dryRun, fileName: plan.fileName, ...plan.preview }));
  if (args.dryRun) return;
  try {
    if (!fs.statSync(plan.inbox).isDirectory()) throw new Error('not_directory');
  } catch (error) {
    console.error('收件箱目录不存在。');
    process.exitCode = 2;
    return;
  }
  const destination = path.join(plan.inbox, plan.fileName);
  if (fs.existsSync(destination) || !writeAtomicFile(destination, raw)) {
    console.error('写入收件箱失败。');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { planInboxWrite, readArgs };
