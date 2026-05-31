/** Max characters of OCR text to store in Firestore (stay under ~1 MiB doc limit with overhead). */
const MAX_TEXT_CHARS = 250_000

/**
 * @param {string} storedText
 */
function deriveFromStoredText(storedText) {
  const lines = storedText.split(/\r?\n/).map((l) => l.trim())
  const nonEmptyLines = lines.filter(Boolean)
  const words = storedText.trim().split(/\s+/).filter(Boolean)

  /** Cheap bag-of-words for simple keyword rules (dedupe, drop very short noise). */
  const freq = new Map()
  for (const w of words) {
    const t = w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toLowerCase()
    if (t.length < 3) continue
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  const tokens = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([t]) => t)

  return {
    nonEmptyLines,
    words,
    tokens,
    metrics: {
      charCount: storedText.length,
      wordCount: words.length,
      lineCount: nonEmptyLines.length,
    },
    keySpans: {
      headline: nonEmptyLines[0] ?? '',
      firstLines: nonEmptyLines.slice(0, 12),
    },
  }
}

/**
 * Build a stable, machine-readable document index from OCR output for rules / automation.
 *
 * @param {{ fileName: string; text: string; confidence: number; engine?: string }} p
 * @returns {{ v: number; indexedAt: string; engine: string; sourceFileName: string; ocr: { confidence: number }; text: string; textTruncated: boolean; metrics: { charCount: number; wordCount: number; lineCount: number }; keySpans: { headline: string; firstLines: string[] }; rulesHint: { tokens: string[] } }}
 */
export function buildMachineIndexFromOcr({ fileName, text, confidence, engine = 'tesseract.js' }) {
  const raw = typeof text === 'string' ? text : ''
  const textTruncated = raw.length > MAX_TEXT_CHARS
  const storedText = textTruncated ? raw.slice(0, MAX_TEXT_CHARS) : raw
  const { metrics, keySpans, tokens } = deriveFromStoredText(storedText)

  return {
    v: 1,
    indexedAt: new Date().toISOString(),
    engine,
    sourceFileName: fileName,
    ocr: {
      confidence: typeof confidence === 'number' ? confidence : 0,
    },
    text: storedText,
    textTruncated,
    metrics,
    keySpans,
    rulesHint: {
      tokens,
    },
  }
}

/**
 * Update stored OCR text (e.g. user edits on Dashboard) while keeping OCR metadata when present.
 *
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {string} newText
 * @param {string} [fileNameFallback]
 */
export function patchMachineIndexText(prev, newText, fileNameFallback = '') {
  const prevObj = prev && typeof prev === 'object' ? prev : {}
  const raw = typeof newText === 'string' ? newText : ''
  const textTruncated = raw.length > MAX_TEXT_CHARS
  const storedText = textTruncated ? raw.slice(0, MAX_TEXT_CHARS) : raw
  const { metrics, keySpans, tokens } = deriveFromStoredText(storedText)

  const ocr =
    prevObj.ocr && typeof prevObj.ocr === 'object'
      ? /** @type {{ confidence?: number }} */ (prevObj.ocr)
      : { confidence: 0 }

  return {
    v: typeof prevObj.v === 'number' ? prevObj.v : 1,
    indexedAt: new Date().toISOString(),
    engine: typeof prevObj.engine === 'string' ? prevObj.engine : 'tesseract.js',
    sourceFileName:
      typeof prevObj.sourceFileName === 'string' && prevObj.sourceFileName
        ? prevObj.sourceFileName
        : fileNameFallback,
    ocr: {
      confidence: typeof ocr.confidence === 'number' ? ocr.confidence : 0,
    },
    text: storedText,
    textTruncated,
    metrics,
    keySpans,
    rulesHint: {
      tokens,
    },
  }
}
