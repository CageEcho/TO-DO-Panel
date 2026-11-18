<div align="center">
  <img src="build/to-do-panel-icon.png" width="112" alt="TO-DO Panel 图标" />
  <h1>TO-DO Panel</h1>
  <p><strong>Mac 与 Windows 的贴顶工作台。</strong></p>
  <p>待办、随笔记、链接、录音与本机 AI 提醒，始终贴顶待命。</p>
  <p>
    <a href="https://github.com/xiaopu-ai/TO-DO-Panel/releases/latest"><strong>上游 macOS 版</strong></a>
    ·
    <a href="https://github.com/xiaopu-ai/TO-DO-Panel/releases/latest"><strong>上游 Windows 版</strong></a>
    ·
    <a href="#从源码运行">从源码运行</a>
    ·
    <a href="#更新日志">更新日志</a>
    ·
    <a href="https://github.com/xiaopu-ai/TO-DO-Panel/issues">反馈问题</a>
  </p>
  <p>
    <img alt="Release" src="https://img.shields.io/github/v/release/xiaopu-ai/TO-DO-Panel?style=flat-square&color=7c8cff" />
    <img alt="macOS 13+ Apple Silicon" src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?style=flat-square&logo=apple" />
    <img alt="Windows 10/11 x64" src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4?style=flat-square" />
    <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-35c58b?style=flat-square" />
    <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron" />
  </p>
</div>

![TO-DO Panel 首页](docs/screenshots/home.png)

![TO-DO Panel 待办](docs/screenshots/todo.png)

## 这个仓库

这是 [CageEcho/TO-DO-Panel](https://github.com/CageEcho/TO-DO-Panel)，基于 [xiaopu-ai/TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel) v1.3.0 的个人工作版。MIT 许可和上游版权声明保持不变。这里没有发布新的安装包；下面的 v1.3.0 下载仍指向官方仓库。

定制版的应用名是 **TO-DO Panel Work**，包标识是 `com.cageecho.todo-panel.work`。它使用自己的数据目录，不会覆盖 `/Applications/TO-DO Panel.app`，也不会写入官方的 `Dynamic Panel` 目录。

| 项目 | 官方 TO-DO Panel | 这个定制版 |
| --- | --- | --- |
| macOS 应用 | `/Applications/TO-DO Panel.app` | 自行打包后的 `TO-DO Panel Work.app` |
| 数据目录 | `~/Library/Application Support/Dynamic Panel` | `~/Library/Application Support/TO-DO Panel Work` |
| Windows 数据目录 | `%APPDATA%\Dynamic Panel` | `%APPDATA%\TO-DO Panel Work` |
| 本机通知端口 | `127.0.0.1:43821` | `127.0.0.1:43831` |

不要把官方应用的数据文件夹选成定制版的数据目录。应用会拒绝写入 `Dynamic Panel`。如果要迁移，先复制一份到新文件夹，再在定制版里选择那份副本。

## 它是什么

TO-DO Panel 是一个常驻 macOS / Windows 屏幕顶部的本地工作台。Mac 默认折叠成物理刘海大小；Windows 显示为贴顶的 200 × 38 逻辑像素悬浮条，避开顶部任务栏。点击后从顶部展开。

| 页面 | 解决什么问题 |
| --- | --- |
| **首页** | 当前窗口、镜子、快速录音、随笔记、常用指令、音乐播放器（自动识别汽水音乐 / 网易云音乐 / QQ音乐 / 酷狗 / 酷我 / Spotify / Apple Music，可切换）和番茄钟集中在一个 Bento 工作台 |
| **待办** | 四个可改名的工作流，新建默认当天 23:30，常驻跨天或唤醒后自动刷新；本条手选日期保留，提交后恢复当天默认值。截止日期可逐月切换并自然跨年，按截止时间排序，并在到期前一小时提醒；本机脚本或 AI 助手可[写文件导入](#从脚本或-ai-助手导入待办) |
| **随笔记** | Markdown 速记、归档、搜索、重命名与智能标题 |
| **链接** | 保存公开网址，后台补全标题、图标和分组 |
| **录制** | 录音开始即创建实时记录，同步显示状态与转写，并可在页内配置 API |
| **密钥** | 使用系统安全存储加密账号、密码和 API Key |
| **设置** | 当菜单栏图标被刘海遮挡时，仍可在面板内配置 API、镜子、首页组件、功能显示、默认展开页、快捷键、数据目录与开机启动 |

剪贴板历史默认关闭，可从菜单栏或面板「设置」的「显示功能」中按需启用。菜单栏入口与设置页读写同一份本机配置；即使状态栏图标过多、被物理刘海遮挡，也不影响调整。Codex、Claude Code 与 GPT 的本机完成事件也可以直接显示为不抢焦点的顶部提醒。

「设置 → 首页组件」可以隐藏或恢复当前平台可用的组件（macOS 七个、Windows 五个），但首页至少保留一个。隐藏后，其余组件会自动重新铺满整个 Bento 网格，不留空洞；组件数据、用户保存的排列顺序和尺寸偏好不会被删除或覆盖。只要存在隐藏组件，首页使用自动填充布局并暂时隐藏尺寸按钮；macOS 恢复全部七个组件后，原尺寸偏好与按钮会一并恢复。Windows 采用自动填充布局。该偏好随当前本地工作区保存，存储键为 `notch-home-hidden-modules-v1`。

面板默认每次从首页展开。可在「设置 → 本机与唤出 → 默认展开页」改为任意当前可见的 Tab；若后续隐藏了被选中的功能，下次展开会自动回退到首页。

首页显隐也遵守资源边界：隐藏镜子会立即释放摄像头；录音进行中不能隐藏仍在首页显示的快速录音卡，但已隐藏该卡也不会禁用「录制」页的录音能力；隐藏音乐和当前窗口会停止纯展示用的 WebGL 动画与窗口扫描，番茄钟隐藏后仍继续计时和提醒。

实时转写连接中断时会保留已有文字并自动重连，连续连接失败最多重试 5 次。重连期间最多缓存最近 30 秒音频，恢复后继续追加转写；首页与录制页会显示重连、失败或缓存溢出提示。本机录音独立继续，已发送但尚未被服务确认的音频、以及超出缓存的离线片段可能缺字，不会自动补转已保存的旧录音。

## 下载与安装

> 当前稳定版本：**1.3.0** · **macOS 13.0+ Apple Silicon** / **Windows 10/11 x64（Intel / AMD 64 位）**

| 平台 | 在上方 GitHub Releases 下载对应安装包 |
| --- | --- |
| Mac | [TO-DO-Panel-1.3.0-arm64.dmg](https://github.com/xiaopu-ai/TO-DO-Panel/releases/download/v1.3.0/TO-DO-Panel-1.3.0-arm64.dmg) |
| Windows | [TO-DO-Panel-1.3.0-windows-x64-setup.exe](https://github.com/xiaopu-ai/TO-DO-Panel/releases/download/v1.3.0/TO-DO-Panel-1.3.0-windows-x64-setup.exe) |

### macOS

1. 前往 [GitHub Releases](https://github.com/xiaopu-ai/TO-DO-Panel/releases/latest) 下载 `TO-DO-Panel-*-arm64.dmg`。
2. 如果应用正在运行，先完全退出，再打开 DMG，将 `TO-DO Panel Work.app` 拖入「应用程序」并替换。不要在应用还开着时覆盖。替换应用不会清空 `~/Library/Application Support/TO-DO Panel Work`，私有转写目录里的 `venv`、`uv-cache` 和 `model-cache` 也留在原处。
3. 首次启动若被 macOS 拦截，前往「系统设置 → 隐私与安全性」，点击「仍要打开」。
4. 再次启动，根据需要授予辅助功能、屏幕录制、麦克风或摄像头权限。

项目明确采用 GitHub Releases + ad-hoc 签名分发，不进行 Apple 公证，也不上架 Mac App Store。因此首次安装需要手动确认“仍要打开”；这是当前正式分发方式，不是待修复的发布缺陷。每次重新打包后，macOS 可能要求重新授权；由 `safeStorage` 加密的密钥也可能需要重新填写。

### Windows

下载 `TO-DO-Panel-*-windows-x64-setup.exe`，运行安装向导，再从桌面或开始菜单启动。默认仅安装给当前用户，无需管理员权限，卸载保留本机工作区数据。托盘菜单可设置功能或退出，面板设置中可开启开机启动。

安装包暂无商业代码签名，可能出现 SmartScreen 提示。请核对来源与 `.sha256` 校验码，确认后通过「更多信息 → 仍要运行」安装；企业策略可能需要管理员批准。

Windows 首版暂不显示「当前窗口」和「音乐」组件；剪贴板点击复制后用 Ctrl+V 粘贴，AI 完成提醒暂不支持点击切回任务窗口。平台限制不覆盖原有组件偏好。镜子仅主动点击后开启，离开首页或收起立即释放；结束录音释放麦克风。系统拒绝访问设备时，请检查 Windows 隐私设置中桌面应用的相机 / 麦克风权限。

Windows 版在 GitHub Windows runner 上自动验证安装、启动、数据保存、加密、快捷键、模拟音视频设备、重新安装和卸载；物理设备、Windows 10 实机及多显示器硬件尚未人工验收。普通工作区可跨平台迁移，加密密钥需在新电脑重新输入。

## 更新日志

当前稳定版本为 **v1.3.0**。正在开发但尚未发布的改动会先记录在 `[未发布]`，正式发版时再归档到对应版本，避免 README 随版本增加而持续膨胀。

完整版本历史、修复内容与未发布改动见 [CHANGELOG.md](CHANGELOG.md)。

## 设计原则

- **贴顶但不打扰**：折叠态宽 200px，高度跟随菜单栏；展开与通知都不使用系统窗口动画。
- **设备按需启用**：镜子只有主动点击才开启，离开首页或收起时立即释放摄像头；麦克风同理。镜子优先用电脑自带相机，iPhone 连续互通和 OBS / Filteronme 等虚拟摄像头排在最后；某个摄像头 3 秒内不出画面就自动换下一个。
- **数据留在本机**：待办、笔记、链接、录音元数据和工作区设置保存在本地，无后端和云同步。
- **权限边界清晰**：链接元数据抓取会阻止本机、内网地址和不安全重定向；窗口聚焦只接受最近扫描缓存中的 ID。
- **可迁移工作区**：可从菜单栏选择数据文件夹，换电脑时复制该文件夹继续使用。

## 本机 AI 完成提醒

官方 TO-DO Panel 监听 `127.0.0.1:43821`。这个定制版改听 `127.0.0.1:43831`，来源仍只限 `codex`、`claude` 与 `gpt`，避免两个应用抢同一个端口。只有在你希望提醒出现在定制版时，才把钩子改到 43831；继续用官方应用时不要改原来的钩子。

```bash
curl -X POST http://127.0.0.1:43831/notify/codex \
  -H 'Content-Type: application/json' \
  -d '{"title":"任务已完成","project":"my-project","task_id":"demo"}'
```

仓库已提供 [Codex 转发脚本](scripts/codex-notify.js) 和 [Claude Code 转发脚本](scripts/claude-notify.js)。定制版打包后的脚本路径为：

```text
/Applications/TO-DO Panel Work.app/Contents/Resources/app/scripts/codex-notify.js
/Applications/TO-DO Panel Work.app/Contents/Resources/app/scripts/claude-notify.js
```

Windows 安装后的两个脚本位于安装目录的 `resources/app/scripts/` 中，可用 Node.js 调用；应用本身无需用户安装 Node.js。

## 从脚本或 AI 助手导入待办

本机脚本或 AI 助手把 JSON 文件放进工作区的 `todo-inbox/` 文件夹。定制版的默认目录是 `~/Library/Application Support/TO-DO Panel Work/todo-inbox/`，不要写到官方的 `Dynamic Panel`。应用运行时约 2 秒检查一次，启动时也会检查。原来的 P0–P3 文件只追加待办，不会修改或删除已有待办。`schema` 为 `grok-work/v1` 的文件进入工作视图，规则见下文。

| 工作区 | 收件箱路径 |
| --- | --- |
| macOS 默认 | `~/Library/Application Support/TO-DO Panel Work/todo-inbox/` |
| Windows 默认 | `%APPDATA%\TO-DO Panel Work\todo-inbox\` |
| 自定义数据文件夹 | `<所选文件夹>/todo-inbox/` |

当前工作区路径可在「设置 → 数据目录」或菜单栏「打开文件夹」查看；切换数据文件夹后，收件箱跟着换到新文件夹。

**文件格式**：顶层可以是 `{ "todos": [...] }`，也可以直接是数组。示例见 [docs/todo-inbox-example.json](docs/todo-inbox-example.json)。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `text` | 是 | 待办内容，最多 80 个字符 |
| `category` | 是 | `P0`–`P3`（不区分大小写），或当前分类显示名（忽略大小写与多余空格）；两者冲突时以 `P0`–`P3` 为准 |
| `deadline` | 否 | ISO 8601 字符串或毫秒时间戳。带时区（`2026-10-08T18:00:00+08:00`）按该时区；不带时区按本机时间；只写日期（`2026-10-15`）为当天 23:30；不填与手动新建一致，为当天 23:30 |
| `id` | 否 | 只能包含字母、数字和 `. _ : -`，最长 128。已存在的 id 不会重复添加 |

```bash
# 推荐先写临时文件再改名，避免读到写了一半的文件；以 . 开头或不以 .json 结尾的文件会被忽略
cp docs/todo-inbox-example.json ~/Library/Application\ Support/TO-DO\ Panel\ Work/todo-inbox/.agent.tmp
mv ~/Library/Application\ Support/TO-DO\ Panel\ Work/todo-inbox/.agent.tmp \
   ~/Library/Application\ Support/TO-DO\ Panel\ Work/todo-inbox/agent-$(date +%s).json
```

**处理结果**：每个文件处理完都会移入 `todo-inbox/processed/`，文件名加时间前缀（如 `20260929-153012-007-agent.json`），同时生成同名的 `.report.json` 报告：

- `status`：`imported` 全部导入；`partial` 部分导入；`none` 没有新增（如全部重复）；`rejected` 整个文件无法识别（如 JSON 解析失败、文件超过 1 MB）。
- `imported` 列出新增条目及分配的 `id`；`skipped` 按 `index`（从 0 开始）列出被跳过的条目和原因；`warnings` 提示截止时间早于导入时间等情况。

**去重规则**：处理过的文件会移走，不会导入第二次。没写 `id` 的条目按「文件内容 + 序号」生成稳定 id，因此内容完全相同的文件再放一次也不会重复添加（除非之前导入的待办已被删除）。格式不对的条目只会被跳过，不影响同一文件中的其他条目。单个文件最多导入 200 条。

`processed/` 不会自动清理，可随时手动删除。

## 工作视图和每日导入

待办页里「工作」在前，「分类待办」在后。新安装、进入待办和重新打开都会先显示工作页；以前记住的分类待办页签不再抢在前面。当次仍可点开分类待办，里面的 `notch-todo-data` 不会被工作页改掉。工作待办单独存在 `notch-work-tasks-v1`。工作页是四宫格：左上在每日工作和每周工作之间切换，右上是自媒体&写作，左下是工作，右下是 Vibe coding。首页的「工作」用同一份数据展示今日工作、待确认和阻塞跟进三列，不是另一套待办。待确认和阻塞跟进在待办页从顶部入口打开。可以直接输入、修改、勾选、删除和设置日期。手工任务标成「手动」，不编造录音依据。自动导入进来的任务仍保留来源和依据；下一次同步不能覆盖或撤回手工任务。分组可以改名。新增这些分组不会扩大本机采集目录。

自动任务必须带稳定 `sourceId`、来源引用和依据摘录。录音时间点有就写，没有就留空。`responsibility` 为 `mine` 才进入所选工作分组；`uncertain` 或未填写进入待确认，不会被改成 `mine`；`other` 不进入待办。截止日期未知就写 `null`，不要编造时间和剩余进度。

整理由外部完成：可以是一次 Grok 对话里整理好的结果，也可以是你自己写的 JSON。应用不把普通聊天当成 API，也不调用其他模型冒充 Grok。当前版本即使配置了 `GROK_API_KEY` 也不会代发请求。没有密钥时，用 `fixtures/work-import/demo-batch.json` 就能完成导入测试。

本机转写和模型请求是两段：

1. 录音仍只在你按下录音后开始，结束或退出时释放麦克风。工作导入不会自动开麦。
2. 在本机把授权根目录写进不进仓库的 `work-source.local.json`（示例只有占位符 `<WORK_ROOT>`）。准备脚本会递归这个根目录里的文本和录音。
3. 录音由本机 faster-whisper 写成文字。Mac 上使用应用自带的 `work-helper`：`uv sync` 只下载 Python 包，第一次转写再把约 487 MB 的 `Systran/faster-whisper-small`（其中 `model.bin` 484 MB）下载到本机缓存。推理走 Apple Silicon 的 CPU int8，不上传音频。PATH 上的 `whisper-cli` 和 `whisper` 不会被当成两个位置参数调用。没有 uv、也没有这些程序时，清单写明 `local_transcriber_missing`。
4. 把 `work-materials/text/` 里已经脱敏的文字交给这次 Grok 对话。助手按下面的契约写出 `grok-work/v1` JSON。当前没有接通 Grok API，也不能凭空调用。
5. `scripts/grok-work-import.js` 校验后原子写入定制版自己的 `todo-inbox/`。应用运行时约 2 秒读取；关闭期间文件留在收件箱，下次打开再处理。

每个工作日的目标是 Asia/Shanghai 09:00 前准备好。提前量默认 60 分钟，准备从 08:00 开始，两项都可以改。自动检查在本机端到端验收前保持关闭。到点后应用只把这一天标成「待提交」，不会凭空生成任务。Mac 睡眠、合盖或关机时定时器不会运行；`scripts/launchd/` 里的 plist 是禁用的示例，应用不会安装它。关机期间不能写入本机待办。

授权根目录的边界：

- 只递归这一个根。`realpath` 必须仍在根目录里面。
- 指到根外的符号链接会跳过，符号链接目录不会再往下走。
- 隐藏文件、凭证文件名（如 `credentials.json`、`.env`、`*.pem`、`*.key`）和可执行文件不读取。
- 超过体积上限的文件记为 `too_large`，不整文件读入。
- 相同内容的录音用 SHA-256 做水位，重复的不再转写。
- 清单里的路径是相对路径，并使用 `rootLabel: "private-local-root"`。绝对路径只留在本机私有配置，不写入仓库。

### TicNote

TicNote 是新增的云端只读来源，不替代、也不扩大已经授权的 Mac 桌面文件夹。设置页保存的 AppKey 由主进程用 `safeStorage` 加密，渲染层只知道是否已保存，不回显完整密钥。只接受国内正式前缀 `tncn_sk_`，登录地址固定为 `POST https://voice-api.ticnote.cn/api/p1/appkey/login`。海外和测试环境的密钥会被拒绝。令牌只留在内存里，遇到重定向就停止，不会把令牌发给下载域名。

连接验证只读取项目名称和文件数。授权名单保存项目 ID 和文件夹 ID，默认是空的。没有选定文件夹时，不读取录音正文、音频或转写，也不遍历其他项目的文件内容。勾选一个文件夹只覆盖它直接包含的录音；子文件夹要单独勾选。同名文件夹不会因为名称相近被自动加入。已有转写按 `recordId` 和 revision 增量读取；没有转写就标成缺失，不会自动提交收费转写、上传、分享或删除。

保存 TicNote 范围不会打开每日任务。日程仍要等本机端到端验收。

### Grok API

整理待办和读取 TicNote 是两件事。应用可以保存一把 xAI API Key，并让你填写模型 ID，不预选一个未确认是否可用的模型。启用之后，已指定 TicNote 文件夹里的转写会作为数据发到 `POST https://api.x.ai/v1/chat/completions`，按该账户的 token 用量计费。转写里的句子不会被当成指令。返回的任务必须能对上原文摘录、来源、责任和日期，否则整次不入库，也不会把材料标成已读。缺密钥、缺模型或没有勾选启用时不会出网。这把密钥不是当前聊天订阅。每日 09:00 前的自动运行仍要等本机验收，现在保持关闭；应用睡眠或离线时不能补到当时，只会在下次打开后标成待补做。

### 协调端读写契约

本机准备：

```bash
node scripts/work-source-prepare.js \
  --root "<WORK_ROOT>" \
  --out "<本机私有目录>/work-materials"
```

需要转写时再加 `--transcribe`。默认使用应用或助手包里的 `uv run ... transcribe.py <音频> <文本>`。这个包装才接受两个位置参数。PATH 上的 `whisper-cli` 会改成 `-f <音频> -otxt -of <输出前缀>`，`whisper` 会改成 `--output_format txt --output_dir <目录>`。显式的 `TODO_PANEL_LOCAL_TRANSCRIBE` 只有在程序名不是 `whisper` 或 `whisper-cli` 时才按两个位置参数调用。云端地址会被拒绝。缺少 uv 和这些程序时，命令以状态码 2 退出，原因是 `local_transcriber_missing`。安装包内的说明在 `Contents/Resources/work-helper/README.md`。

助手读取的最小材料是本机 `work-materials/manifest.json` 和 `work-materials/text/*.txt`。这些文字需要已经脱敏。助手不读取授权根目录，也没有 Grok API key。

助手写回一个文件，交给：

```bash
node scripts/grok-work-import.js \
  --inbox "$HOME/Library/Application Support/TO-DO Panel Work/todo-inbox" \
  --file "<整理结果>.json"
```

样例（来源用占位相对路径）：

```json
{
  "schema": "grok-work/v1",
  "generator": "grok-assistant",
  "batchId": "weekday-morning",
  "workDate": "2026-11-18",
  "generatedAt": "2026-11-18T08:10:00+08:00",
  "sourceKey": "private-local-root",
  "sourceCursor": "audio-watermark",
  "tasks": [
    {
      "sourceId": "recordings/sample#00:01:00#follow-up",
      "action": "upsert",
      "revision": 1,
      "text": "根据本地转写整理出的一条待办",
      "responsibility": "mine",
      "group": "today",
      "deadline": null,
      "evidence": {
        "excerpt": "转写里明确由我跟进的一句话。",
        "sourceRef": "text/recordings_sample.m4a.txt",
        "recordingAt": "00:01:00"
      }
    }
  ]
}
```

还缺的本机组件：一个不上传音频的本地转写程序。百炼实时转写仍只用于你按录音键时的在线转写，不走这条每日通路。Grok API 没有接通。

### 导入协议

文件放进定制版工作区的 `todo-inbox/`。顶层 `schema` 必须是 `grok-work/v1`。没有这个字段的文件仍按原来的 P0–P3 规则追加，不会改成工作待办。

```json
{
  "schema": "grok-work/v1",
  "generator": "grok-assistant",
  "batchId": "2026-11-18-morning",
  "workDate": "2026-11-18",
  "generatedAt": "2026-11-18T08:40:00+08:00",
  "sourceKey": "demo-standup",
  "sourceCursor": "demo-standup#00:12:18",
  "tasks": [
    {
      "sourceId": "demo-standup#00:04:12#summary",
      "action": "upsert",
      "revision": 1,
      "text": "把接口说明补进本地文档",
      "responsibility": "mine",
      "group": "today",
      "deadline": null,
      "evidence": {
        "excerpt": "我来把接口说明补进文档。",
        "sourceRef": "fixtures/transcripts/demo-standup.txt",
        "recordingAt": "00:04:12"
      }
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `generator` | 可省略，或只能是 `fixture`、`grok-assistant`、`manual-file`。其他模型名称会被整份拒绝 |
| `tasks` | 数组。没有材料时传 `[]`，应用不会补任务。单个文件最多 100 条，文件最大 1 MB |
| `sourceId` | 必填，1–160 字符，只允许字母、数字和 `. _ : @ # / -`，不能含 `..` 或绝对路径 |
| `action` | `upsert` 或 `revoke`。撤回不会删除已完成或已手工改过的任务 |
| `revision` | 可选整数。更小的版本不会覆盖 |
| `responsibility` | `mine`、`uncertain`、`other`。不能写人名 |
| `group` | `today`、`weekly`、`media`、`vibe`、`desk`、`confirm`、`blocked`，或已存在分组的 id / 唯一名称。未知分组里的本人任务进入每日工作。`uncertain` 一律进入待确认 |
| `deadline` | 带时区的 ISO 8601，或 `null`。只有日期、没有时区都会拒绝，不会改成当天 23:30 |
| `evidence.excerpt` | 必填，最多 500 字 |
| `evidence.sourceRef` | 必填，只作为文字显示，应用不会按它打开文件 |
| `evidence.recordingAt` | 可空。无法识别时留空并在报告里警告 |
| `workDate` | `YYYY-MM-DD`。用来标记这一天的整理已经提交，包括空任务列表 |

`owner` 和 `assignee` 会被忽略。同一 `sourceId` 再导入一次不会复制。相同文件哈希直接视为已处理。用户改过的标题、分组、截止日期和完成状态保持原样；未锁定的依据摘录可以更新。用户移除导入任务后，后来的文件不能把它加回来。

```bash
node scripts/grok-work-import.js \
  --inbox "$HOME/Library/Application Support/TO-DO Panel Work/todo-inbox" \
  --file fixtures/work-import/demo-batch.json \
  --dry-run
```

去掉 `--dry-run` 才会写入。不要在参数里放 API Key。处理报告仍在 `todo-inbox/processed/*.report.json`。

每日时刻写在工作区的 `work-schedule.json`，只含时区、是否工作日、是否启用和时间，不含转写内容。可选的判断脚本：

```bash
node scripts/grok-work-schedule.js --config "$HOME/Library/Application Support/TO-DO Panel Work/work-schedule.json"
```

它只打印是否到点，不生成待办。

### 配置、开发与 Mac 打包

桌面端要求 Node.js 22.12.0+。下面的命令在这个 fork 的源码目录执行：

```bash
git clone https://github.com/CageEcho/TO-DO-Panel.git
cd TO-DO-Panel
npm install
npm test
npm start
```

`npm test` 包含工作导入的逻辑测试。当前环境如果不是 Mac，就不能把测试结果说成已经验证了 Mac 界面。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 单元测试、导入测试和 JavaScript 语法检查 |
| `npm start` | 启动 Electron 开发版，数据写在 `TO-DO Panel Work` |
| `npm run pack` | 在 Mac 上生成未安装的 `.app` |
| `npm run build` | 在 Mac arm64 上生成 `TO-DO-Panel-Work-*-arm64.dmg` |
| `npm run build:win` | 生成 Windows x64 EXE。建议在 Windows 上构建 |

Mac 安装包路径：在 Apple Silicon 的 macOS 13+ 上执行 `npm run build`，产物在 `dist.noindex/TO-DO-Panel-Work-<version>-arm64.dmg`。拖进「应用程序」后名称是 `TO-DO Panel Work.app`，与官方应用并列。项目沿用上游的 ad-hoc 签名，不公证；首次打开需要在系统设置里确认。签名和公证不在这次源码改动里完成。

开发版和打包版第一次启动都会创建新的数据目录。官方应用里的待办、笔记、录音和密钥不会被移动或删除。

### 迁移与回滚

工作导入每次改动前，把上一份 `notch-work-tasks-v1` 原子写入工作区的 `work-import-backups/`，只保留最近 20 份。回滚时：

1. 退出 TO-DO Panel Work。
2. 打开数据目录里的 `workspace.json`，找到 `localStorage["notch-work-tasks-v1"]`。
3. 用备份文件里的 JSON 替换这个字符串值；不要改 `notch-todo-data` 和其他键。
4. 如果导入文件还在 `todo-inbox/processed/`，把它移回 `todo-inbox/` 会再次处理。相同内容不会复制任务；要撤销已导入结果，应先恢复备份再打开应用。

不想再使用定制版时，退出并删除 `TO-DO Panel Work.app` 与 `~/Library/Application Support/TO-DO Panel Work`。不要删除 `Dynamic Panel`，那是官方应用的数据。

### 权限与隐私

- 工作导入没有新增公网端口，也没有浏览器跨域写入。唯一的本机通知端口仍只接受原来的来源白名单，并且改到 `43831`，避免占用官方应用的 `43821`。
- 转写采集默认关闭。打开后也只返回文件名、大小和修改时间，不把内容发给模型。
- 密钥继续只进系统安全存储。仓库、日志和导入脚本的参数都不接受 API Key。
- 依据摘录按文本显示，不作为 HTML 执行。
- 真实录音、公司文档和真实转写不要放进仓库。示例只用 `fixtures/` 里的合成内容。

## 从源码运行

桌面端要求 Node.js 22.12.0+：

```bash
git clone https://github.com/CageEcho/TO-DO-Panel.git
cd TO-DO-Panel
npm install
npm test
npm start
```

项目使用单一 Electron 架构，没有渲染层构建步骤，`npm start` 是完整运行路径。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 单元测试与 JavaScript 语法检查 |
| `npm start` | 启动 Electron 开发版 |
| `npm run pack` | 生成未安装的 `.app` |
| `npm run build` | 生成 Apple Silicon DMG |
| `npm run build:win` | 生成 Windows x64 EXE 安装包（建议 Windows 环境构建） |
| `npm run build:zip` | 生成 ZIP 分发包 |

官网位于 `website/`，要求 Node.js 22.13.0+：

```bash
cd website
npm install
npm run dev
```

## 项目结构

```text
.
├── main.js                 # Electron 主进程、窗口与系统服务
├── main-services.js        # 可测试的纯领域服务
├── preload.js              # contextBridge 安全桥
├── renderer/               # 桌面界面与交互
├── tests/                  # Node 单元测试
├── build/                  # 图标、签名与 DMG 配置
├── scripts/                # Codex / Claude Code 通知转发
├── docs/                   # 设计、ADR 与发布说明
└── website/                # React 19 + Vinext 官网
```

## 发布

推送与 `package.json` 版本一致的 `v*.*.*` 标签后，GitHub Actions 并行测试、构建并校验 macOS DMG 和 Windows EXE。两个平台全部通过后，才创建同一个 Release 并上传两个安装包及各自 SHA-256 文件。完整流程见 [发布说明](docs/releasing.md)。

## License

[MIT](LICENSE) © 2026 [xiaopu-ai](https://github.com/xiaopu-ai) 与贡献者。工作视图改动由 [CageEcho](https://github.com/CageEcho) 维护在本 fork，不改变上游许可。
