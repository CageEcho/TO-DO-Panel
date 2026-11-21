#!/usr/bin/env node
'use strict';

// 只判断 Asia/Shanghai 的工作日时刻是否已到。
// 不安装 launchd，不生成待办，不读取转写，不联网。
// macOS 睡眠时 launchd 可能推迟或跳过；应用下次打开才会处理已经放进收件箱的文件。

const fs = require('node:fs');
const { evaluateWorkSchedule } = require('../renderer/work-domain');

function readArgs(argv) {
  const args = { config: '', now: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') args.config = argv[++index] || '';
    else if (arg === '--now') args.now = argv[++index] || '';
    else if (arg.startsWith('--')) return { error: 'unknown_arg' };
  }
  return args;
}

function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.error || !args.config) {
    console.error('用法：node scripts/grok-work-schedule.js --config <work-schedule.json> [--now <ISO>]');
    process.exitCode = 2;
    return;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  } catch (error) {
    console.error('无法读取日程配置。');
    process.exitCode = 2;
    return;
  }
  const now = args.now ? new Date(args.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    console.error('--now 不是有效时间。');
    process.exitCode = 2;
    return;
  }
  const decision = evaluateWorkSchedule(config, now);
  console.log(JSON.stringify(decision));
}

if (require.main === module) main();

module.exports = { readArgs };
