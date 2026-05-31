from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .classifier import DocumentClassifier


class ClassifyRequest(BaseModel):
    text: str = Field(default="", description="OCR extracted text")
    labels: list[str] | None = Field(default=None, description="Candidate labels override")
    threshold: float | None = Field(default=None, description="Unknown threshold override")


class ClassifyResponse(BaseModel):
    category: str
    confidence: float
    scores_by_label: dict[str, float]


app = FastAPI(title="Documind Classifier", version="1.0.0")

# Allow Vite dev server to call this locally.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest) -> Any:
    clf = DocumentClassifier(
        labels=tuple(req.labels) if req.labels else ("invoice", "receipt", "id card", "report"),
        unknown_threshold=float(req.threshold) if req.threshold is not None else 0.60,
    )
    result = clf.classify_text(req.text or "")
    return {
        "category": result.category,
        "confidence": result.confidence,
        "scores_by_label": result.scores_by_label,
    }

