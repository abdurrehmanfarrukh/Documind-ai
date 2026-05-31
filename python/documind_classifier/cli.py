from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .classifier import DocumentClassifier


def _read_text_arg(text: str | None, text_file: str | None) -> str:
    if text is not None and text.strip():
        return text
    if text_file:
        return Path(text_file).read_text(encoding="utf-8", errors="replace")
    # Support piping OCR text in
    if not sys.stdin.isatty():
        piped = sys.stdin.read()
        if piped.strip():
            return piped
    return ""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="documind-classify",
        description="Classify OCR text with BART MNLI and move the file into a category folder.",
    )
    p.add_argument("--file", required=True, help="Path to the file to move.")
    p.add_argument(
        "--outdir",
        required=True,
        help="Root folder where category folders will be created.",
    )
    g = p.add_mutually_exclusive_group(required=False)
    g.add_argument("--text", help="OCR extracted text.")
    g.add_argument("--text-file", help="Path to a UTF-8 text file containing OCR output.")
    p.add_argument(
        "--threshold",
        type=float,
        default=0.60,
        help='If top confidence is below this, label becomes "unknown". Default: 0.60',
    )
    p.add_argument(
        "--model",
        default="facebook/bart-large-mnli",
        help='HF model name. Default: "facebook/bart-large-mnli".',
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON result.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    text = _read_text_arg(args.text, args.text_file)

    clf = DocumentClassifier(model_name=args.model, unknown_threshold=args.threshold)
    result, moved_to = clf.classify_and_move(
        file_path=args.file,
        text=text,
        output_root=args.outdir,
    )

    payload = {
        "category": result.category,
        "confidence": result.confidence,
        "scores_by_label": result.scores_by_label,
        "moved_to": str(moved_to),
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print(f'category="{payload["category"]}" confidence={payload["confidence"]:.3f}')
        print(f'moved_to="{payload["moved_to"]}"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

