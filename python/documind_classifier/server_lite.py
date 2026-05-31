"""
Lightweight classifier API — keyword rules only (no PyTorch).
Runs on Render free tier (~512 MB RAM).
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .classifier import _keyword_override


class ClassifyRequest(BaseModel):
    text: str = Field(default="", description="OCR extracted text")
    threshold: float | None = Field(default=None, description="Unknown threshold override")


class ClassifyResponse(BaseModel):
    category: str
    confidence: float
    scores_by_label: dict[str, float]


app = FastAPI(title="Documind Classifier (Lite)", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "keyword-only"}


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest) -> Any:
    threshold = float(req.threshold) if req.threshold is not None else 0.60
    override = _keyword_override(req.text or "")
    if override is not None:
        cat, score, scores = override
        if score < threshold:
            return {"category": "unknown", "confidence": score, "scores_by_label": scores}
        return {"category": cat, "confidence": score, "scores_by_label": scores}
    return {"category": "unknown", "confidence": 0.0, "scores_by_label": {}}
