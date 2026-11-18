#!/usr/bin/env node
'use strict';

// 可选的 Grok API 边界。本脚本不把聊天记录当成 API，也不调用其他模型。
// 没有 GROK_API_KEY / GROK_API_BASE 时直接退出。即使环境已配置，当前版本也不代发请求：
// 整理结果应写成 grok-work/v1 JSON，再交给 grok-work-import.js。密钥不要出现在参数或输出里。

const { assessGrokAdapter } = require('../renderer/work-domain');

function main() {
  const decision = assessGrokAdapter({ env: process.env, argv: process.argv.slice(2) });
  const message = {
    chat_is_not_api: '普通聊天不是 API。请在对话里整理后，把 JSON 文件写入 todo-inbox。',
    secret_on_argv: '不要把密钥放在命令行参数里。',
    not_configured: '没有配置 Grok API。当前不需要密钥，用合成 JSON 即可导入。',
    bad_base_url: 'GROK_API_BASE 不是合法地址。',
    refusing_non_grok_host: '只接受 api.x.ai。不会改用其他模型冒充 Grok。',
    adapter_does_not_send: decision.detail,
  };
  console.error(message[decision.reason] || '适配器未发送请求。');
  process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { main };
