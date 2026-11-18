# TO-DO Panel Work 本地助手

这个目录随 DMG 放在应用里，也可以单独解压使用。不需要克隆源码，不需要 Homebrew、ffmpeg 或已经装好的 `whisper`。

本机需要已经有的三个程序：Node.js、python3、uv。

应用内路径：

```text
/Applications/TO-DO Panel Work.app/Contents/Resources/work-helper
```

单独解压后，在解压目录里执行同样的命令。真实工作目录只放在本机私有配置，不要写进仓库。

## 不要写进签名应用

把这个目录复制到私有运行目录后再建虚拟环境。不要在 `/Applications/TO-DO Panel Work.app` 里执行 `uv sync`，否则会把 venv 和缓存写进已签名的包。

```bash
PRIVATE="$HOME/Library/Application Support/TO-DO Panel Work/local-transcribe"
mkdir -p "$PRIVATE"
cp -R /Applications/TO-DO\ Panel\ Work.app/Contents/Resources/work-helper "$PRIVATE/helper"
```

如果已经有一份私有 helper，只替换其中的 `transcribe/pyproject.toml`、`transcribe/uv.lock` 和 `transcribe/transcribe.py`，不要删除旁边的模型缓存。

## 第一次准备

faster-whisper 1.2.1 会调用 `av.open(metadata_errors="ignore")`。PyAV 19 已删除这个参数，所以这里锁定 `av==18.1.0`，并固定 `ctranslate2==4.9.0`、`onnxruntime==1.32.0`、`tokenizers==0.23.3`。需要 Python 3.11 或更新；当前验收环境是 uv 的 CPython 3.12.14。

```bash
export UV_PROJECT_ENVIRONMENT="$PRIVATE/venv"
export UV_CACHE_DIR="$PRIVATE/uv-cache"
export HF_HOME="${HF_HOME:-$PRIVATE/model-cache}"
export HUGGINGFACE_HUB_CACHE="$HF_HOME/hub"
export PYTHONDONTWRITEBYTECODE=1
uv sync --frozen --project "$PRIVATE/helper/transcribe"
```

`uv sync --frozen` 会按 `uv.lock` 新建或更新私有 venv。已经下载的 small 模型大约 486 MB，如果它在 `~/.cache/huggingface`，升级前执行 `export HF_HOME="$HOME/.cache/huggingface"`，就不会重新下载。只重建 venv 是安全的：av 从 19.0.2 换成 18.1.0，模型缓存保持不动。

第一次真正转写仍会在 `HF_HOME` 下载 `Systran/faster-whisper-small`。Hugging Face 公布 `model.bin` 为 484 MB，加上 tokenizer 后约 487 MB。推理使用 CPU int8，音频不上传。

权重大小（Hugging Face 公布的文件）：

| 文件 | 大小 |
| --- | --- |
| `model.bin` | 484 MB |
| `tokenizer.json` | 2.2 MB |
| `vocabulary.txt` | 460 kB |
| `config.json` | 约 2 kB |

合计约 487 MB。`compute_type=int8` 只在内存里量化，不会把下载体积变成更小的文件。Apple Silicon 上使用 CPU，不使用 CUDA，也不把音频送到云端。

```bash
uv run --frozen --project "$PRIVATE/helper/transcribe" \
  python "$PRIVATE/helper/transcribe/transcribe.py" \
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
