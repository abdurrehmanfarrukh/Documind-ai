# Documind Python document classifier

Zero-shot document classification using Hugging Face Transformers with `facebook/bart-large-mnli`.

## What it does

- Classifies OCR text into: `invoice`, `receipt`, `id card`, `report`
- If top confidence < `0.6`, assigns `unknown`
- Creates output folders dynamically (one per category)
- Moves the original file into the correct folder
- Loads the model **once per Python process** (singleton pipeline)

## Install

Create/activate a virtualenv, then:

```bash
pip install -r requirements.txt
```

Note: PyTorch + Transformers support depends on your Python version. If installs fail on Python 3.13, use Python 3.11/3.12.

## Run (CLI)

```bash
python -m documind_classifier.cli --file "C:\path\to\doc.pdf" --outdir "C:\sorted" --text-file "C:\ocr.txt" --json
```

Or pass text directly:

```bash
python -m documind_classifier.cli --file "C:\path\to\doc.pdf" --outdir "C:\sorted" --text "…"
```

Or pipe:

```bash
type C:\ocr.txt | python -m documind_classifier.cli --file "C:\path\to\doc.pdf" --outdir "C:\sorted"
```

## Run (classifier service for the web app)

This exposes `POST /classify` so the Vite app can call it. In `documind-ai/.env`, set:

- `VITE_DOC_CLASSIFIER_URL=http://127.0.0.1:8008`

Then run:

```bash
uvicorn documind_classifier.server:app --host 127.0.0.1 --port 8008
```

## Use from code

```python
from documind_classifier import DocumentClassifier

clf = DocumentClassifier()
result, moved_to = clf.classify_and_move(
    file_path=r"C:\path\to\doc.pdf",
    text=ocr_text,
    output_root=r"C:\sorted",
)
```

