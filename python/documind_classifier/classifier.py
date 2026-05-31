from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Literal


Category = Literal["invoice", "receipt", "id card", "report", "unknown"]


@dataclass(frozen=True, slots=True)
class ClassificationResult:
    category: Category
    confidence: float
    scores_by_label: dict[str, float]


def _safe_category_folder_name(category: str) -> str:
    """
    Keep folder names stable + filesystem friendly.
    We intentionally map "id card" -> "id-card".
    """
    t = category.strip().lower()
    t = t.replace("_", "-").replace(" ", "-")
    return t or "unknown"


@lru_cache(maxsize=1)
def _get_zero_shot_pipeline(model_name: str):
    # Lazy import so callers that only do filesystem ops don't pay import cost.
    from transformers import pipeline  # type: ignore

    device = os.getenv("HF_DEVICE", "").strip()
    # transformers uses: device=-1 (CPU), or 0..n for CUDA devices
    device_id = -1
    if device:
        try:
            device_id = int(device)
        except ValueError:
            device_id = -1

    return pipeline(
        task="zero-shot-classification",
        model=model_name,
        device=device_id,
    )


class DocumentClassifier:
    """
    Zero-shot document classifier using `facebook/bart-large-mnli`.

    - Loads the HF pipeline once per Python process (via an LRU singleton).
    - Classifies into a fixed label set; if top score < threshold => "unknown".
    """

    def __init__(
        self,
        *,
        model_name: str = "facebook/bart-large-mnli",
        labels: Iterable[str] = ("invoice", "receipt", "id card", "report"),
        unknown_threshold: float = 0.60,
    ) -> None:
        self._model_name = model_name
        self._labels = tuple(labels)
        if not self._labels:
            raise ValueError("labels must not be empty")
        if not (0.0 <= unknown_threshold <= 1.0):
            raise ValueError("unknown_threshold must be in [0, 1]")
        self._unknown_threshold = float(unknown_threshold)

    def classify_text(self, text: str) -> ClassificationResult:
        if not isinstance(text, str) or not text.strip():
            return ClassificationResult(
                category="unknown",
                confidence=0.0,
                scores_by_label={},
            )

        # Keyword-first override. This improves reliability when OCR text contains strong signals,
        # and avoids expensive model calls for obvious cases.
        override = _keyword_override(text)
        if override is not None:
            cat, score, scores_by_label = override
            # If override is still below threshold, keep unknown behavior consistent.
            if score < self._unknown_threshold:
                return ClassificationResult(
                    category="unknown",
                    confidence=score,
                    scores_by_label=scores_by_label,
                )
            return ClassificationResult(
                category=cat,
                confidence=score,
                scores_by_label=scores_by_label,
            )

        pipe = _get_zero_shot_pipeline(self._model_name)

        # `multi_label=False` yields a single best label distribution.
        out = pipe(
            text,
            candidate_labels=list(self._labels),
            hypothesis_template="This document is {}.",
            multi_label=False,
            truncation=True,
        )

        labels = out.get("labels") or []
        scores = out.get("scores") or []
        scores_by_label = {
            str(l): float(s) for l, s in zip(labels, scores, strict=False) if l is not None
        }

        best_label = str(labels[0]) if labels else "unknown"
        best_score = float(scores[0]) if scores else 0.0

        category: Category
        if best_score < self._unknown_threshold:
            category = "unknown"
        else:
            # Normalize to our exact set
            category = best_label if best_label in (*self._labels, "unknown") else "unknown"  # type: ignore[assignment]

        return ClassificationResult(
            category=category,
            confidence=best_score,
            scores_by_label=scores_by_label,
        )


def _keyword_override(
    text: str,
) -> tuple[Category, float, dict[str, float]] | None:
    """
    Lightweight heuristic pass.
    Returns (category, confidence, scores_by_label) or None if no strong signal.
    """
    t = " ".join(text.lower().split())

    def has_any(words: list[str]) -> bool:
        return any(w in t for w in words)

    def count_any(words: list[str]) -> int:
        return sum(1 for w in words if w in t)

    invoice_words = [
        "invoice",
        "invoice no",
        "invoice number",
        "bill to",
        "billed to",
        "tax invoice",
        "vat",
        "gst",
        "subtotal",
        "total due",
        "amount due",
        "balance due",
        "due date",
        "terms",
        "purchase order",
        "po number",
    ]
    receipt_words = [
        "receipt",
        "thank you for your purchase",
        "cashier",
        "change",
        "tender",
        "subtotal",
        "total",
        "card",
        "visa",
        "mastercard",
        "amex",
        "store",
        "terminal",
        "auth code",
    ]
    id_words = [
        "id card",
        "identity",
        "date of birth",
        "dob",
        "nationality",
        "issued",
        "expires",
        "expiry",
        "sex",
        "height",
        "address",
        "signature",
    ]
    report_words = [
        "report",
        "executive summary",
        "introduction",
        "methodology",
        "results",
        "findings",
        "conclusion",
        "references",
        "appendix",
        "table of contents",
    ]

    inv_hits = count_any(invoice_words)
    rec_hits = count_any(receipt_words)
    id_hits = count_any(id_words)
    rep_hits = count_any(report_words)

    scores = {
        "invoice": inv_hits,
        "receipt": rec_hits,
        "id card": id_hits,
        "report": rep_hits,
    }
    best = max(scores.items(), key=lambda x: x[1])
    best_label, best_hits = best

    # Require a minimum evidence level to override.
    if best_hits < 2:
        return None

    # Convert hits into a conservative confidence-like number.
    # 2 hits => 0.75, 3 => 0.85, 4+ => 0.92
    conf = 0.75 if best_hits == 2 else 0.85 if best_hits == 3 else 0.92

    # Small guard: if receipt and invoice both fire similarly, avoid overriding.
    sorted_hits = sorted(scores.values(), reverse=True)
    if len(sorted_hits) >= 2 and sorted_hits[0] == sorted_hits[1] and sorted_hits[0] >= 2:
        return None

    scores_by_label = {k: float(v) for k, v in scores.items()}
    return best_label, conf, scores_by_label  # type: ignore[return-value]

    def move_file_by_category(
        self,
        *,
        file_path: str | Path,
        category: str,
        output_root: str | Path,
    ) -> Path:
        src = Path(file_path).expanduser().resolve()
        if not src.exists() or not src.is_file():
            raise FileNotFoundError(f"File not found: {src}")

        root = Path(output_root).expanduser().resolve()
        folder = root / _safe_category_folder_name(category)
        folder.mkdir(parents=True, exist_ok=True)

        dest = folder / src.name
        if dest.exists():
            stem, suffix = src.stem, src.suffix
            i = 1
            while True:
                candidate = folder / f"{stem} ({i}){suffix}"
                if not candidate.exists():
                    dest = candidate
                    break
                i += 1

        # `shutil.move` is atomic-ish when moving on same filesystem; otherwise copy+delete.
        moved_to = shutil.move(str(src), str(dest))
        return Path(moved_to).resolve()

    def classify_and_move(
        self,
        *,
        file_path: str | Path,
        text: str,
        output_root: str | Path,
    ) -> tuple[ClassificationResult, Path]:
        result = self.classify_text(text)
        moved_path = self.move_file_by_category(
            file_path=file_path,
            category=result.category,
            output_root=output_root,
        )
        return result, moved_path

