import { classifyByKeywords } from './keywordClassify'

/**
 * Classify OCR text. Uses free in-browser keyword rules by default.
 * Optionally calls a Python ML service when `VITE_DOC_CLASSIFIER_URL` is set.
 *
 * @param {{ text: string; labels?: string[]; threshold?: number }} payload
 * @returns {Promise<{ category: string; confidence: number; scores_by_label?: Record<string, number> }>}
 */
export async function classifyDocumentFromOcrText({ text, labels, threshold }) {
  const unknownThreshold = typeof threshold === 'number' ? threshold : 0.6
  const normalizedText = typeof text === 'string' ? text : ''

  const keywordResult = classifyByKeywords(normalizedText, { threshold: unknownThreshold })
  if (keywordResult && keywordResult.category !== 'unknown') {
    return keywordResult
  }

  const base = String(import.meta.env.VITE_DOC_CLASSIFIER_URL || '').trim().replace(/\/+$/, '')
  if (!base) {
    if (keywordResult) return keywordResult
    return { category: 'unknown', confidence: 0, scores_by_label: {} }
  }

  let res
  try {
    res = await fetch(`${base}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: normalizedText,
        labels: Array.isArray(labels) ? labels : undefined,
        threshold: unknownThreshold,
      }),
    })
  } catch (e) {
    if (keywordResult) return keywordResult
    throw new Error(
      `Could not reach classifier at ${base}/classify. Is the Python server running? (${e?.message ?? String(e)})`,
    )
  }
  if (!res.ok) {
    if (keywordResult) return keywordResult
    const msg = await res.text().catch(() => '')
    throw new Error(
      `Classifier request failed (${res.status}) from ${base}/classify. ${
        msg ? `Details: ${msg}` : 'Check the classifier server logs.'
      }`,
    )
  }
  const data = await res.json()
  return {
    category: String(data?.category ?? 'unknown'),
    confidence: Number(data?.confidence ?? 0),
    scores_by_label:
      data?.scores_by_label && typeof data.scores_by_label === 'object'
        ? data.scores_by_label
        : undefined,
  }
}
