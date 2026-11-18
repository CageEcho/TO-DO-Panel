#!/usr/bin/env python3
"""把一个本地音频文件转成一个文本文件。

这是 TO-DO Panel Work 的 faster-whisper 适配器。推理在本机 CPU 上完成，
不读取 API key，也不把音频发到网络。模型权重只在第一次运行时下载到本机缓存。
"""

from __future__ import annotations

import argparse
from pathlib import Path


def format_timestamp(seconds: float) -> str:
    whole = max(0, int(seconds))
    return f"{whole // 3600:02d}:{(whole % 3600) // 60:02d}:{whole % 60:02d}"


def transcribe(audio: Path, output: Path, model_name: str, device: str, compute_type: str) -> None:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(str(audio), vad_filter=False)
    lines = []
    for segment in segments:
        text = (segment.text or "").strip()
        if text:
            lines.append(f"[{format_timestamp(segment.start)}] {text}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(("\n".join(lines) + "\n") if lines else "", encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local faster-whisper transcription")
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.audio.is_file():
        print("audio file is missing", flush=True)
        return 2
    transcribe(args.audio, args.output, args.model, args.device, args.compute_type)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
