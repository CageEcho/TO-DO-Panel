# TO-DO Panel Work 本地助手

这个目录随 DMG 放在应用里，也可以单独解压使用。不需要克隆源码，不需要 Homebrew、ffmpeg 或已经装好的 `whisper`。

本机需要已经有的三个程序：Node.js、python3、uv。

应用内路径：

```text
/Applications/TO-DO Panel Work.app/Contents/Resources/work-helper
```

单独解压后，在解压目录里执行同样的命令。真实工作目录只放在本机私有配置，不要写进仓库。

## 第一次准备

在 `transcribe/` 里建立隔离环境。这一步只从 PyPI 下载 Python 包，大约几十到一百多 MB（faster-whisper 1.2.1、CTranslate2、PyAV、onnxruntime、tokenizers）。具体字节数以 `uv sync` 的输出为准。

```bash
cd transcribe
uv sync
```

然后转写一个文件。第一次会把 `Systran/faster-whisper-small` 下载到本机 Hugging Face 缓存，不会上传音频。

权重大小（Hugging Face 公布的文件）：

| 文件 | 大小 |
| --- | --- |
| `model.bin` | 484 MB |
| `tokenizer.json` | 2.2 MB |
| `vocabulary.txt` | 460 kB |
| `config.json` | 约 2 kB |

合计约 487 MB。`compute_type=int8` 只在内存里量化，不会把下载体积变成更小的文件。Apple Silicon 上使用 CPU，不使用 CUDA，也不把音频送到云端。

```bash
uv run --project transcribe python transcribe/transcribe.py \
  "<一个本地音频>" "<输出.txt>" --model small --device cpu --compute-type int8
```

没有网络时，权重还没缓存就会失败。这时不要改用会上传音频的服务。

## 每日整理

```bash
node scripts/work-source-prepare.js \
  --root "<WORK_ROOT>" \
  --out "<本机私有目录>/work-materials" \
  --transcribe
```

`--transcribe` 会优先使用旁边的 uv 工程。它不会把 PATH 上的 `whisper-cli` 或 `whisper` 当成两个位置参数来调用。

导入：

```bash
node scripts/grok-work-import.js \
  --inbox "$HOME/Library/Application Support/TO-DO Panel Work/todo-inbox" \
  --file "<整理结果>.json"
```

日程默认关闭。这个包不会打开每天 08:00 的自动检查，也不会安装 launchd。

校验这个目录时，对照 `SHA256SUMS`：

```bash
shasum -a 256 -c SHA256SUMS
```
