import { classifyByKeywords } from './keywordClassify'

function isLocalClassifierUrl(base) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(base)
}

/**
 * Classify OCR text. Uses free in-browser keyword rules by default.
 * Optionally calls a Python ML service when `VITE_DOC_CLASSIFIER_URL` is set.
 *
 * @param {{ text: string; fileName?: string; labels?: string[]; threshold?: number }} payload
 * @returns {Promise<{ category: string; confidence: number; scores_by_label?: Record<string, number> }>}
 */
export async function classifyDocumentFromOcrText({ text, fileName, labels, threshold }) {
  const unknownThreshold = typeof threshold === 'number' ? threshold : 0.6
  const normalizedText = typeof text === 'string' ? text : ''

  const keywordResult = classifyByKeywords(normalizedText, {
    threshold: unknownThreshold,
    fileName,
  })
  if (keywordResult && keywordResult.category !== 'unknown') {
    return keywordResult
  }

  const base = String(import.meta.env.VITE_DOC_CLASSIFIER_URL || '').trim().replace(/\/+$/, '')
  const onLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const skipRemote = !base || (isLocalClassifierUrl(base) && !onLocalhost)

  if (skipRemote) {
    return keywordResult ?? { category: 'unknown', confidence: 0, scores_by_label: {} }
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
  } catch {
    return keywordResult ?? { category: 'unknown', confidence: 0, scores_by_label: {} }
  }
  if (!res.ok) {
    return keywordResult ?? { category: 'unknown', confidence: 0, scores_by_label: {} }
  }
  const data = await res.json()
  const remoteCategory = String(data?.category ?? 'unknown')
  if (remoteCategory === 'unknown' && keywordResult) return keywordResult
  return {
    category: remoteCategory,
    confidence: Number(data?.confidence ?? 0),
    scores_by_label:
      data?.scores_by_label && typeof data.scores_by_label === 'object'
        ? data.scores_by_label
        : undefined,
  }
}
