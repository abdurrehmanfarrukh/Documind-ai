/**
 * Call the local/remote document classifier service (Python) to classify OCR text.
 *
 * Configure via `VITE_DOC_CLASSIFIER_URL`, e.g. `http://127.0.0.1:8008`.
 * The service should expose POST `${baseUrl}/classify` returning:
 *   { category: string, confidence: number, scores_by_label?: Record<string, number> }
 *
 * @param {{ text: string; labels?: string[]; threshold?: number }} payload
 * @returns {Promise<{ category: string; confidence: number; scores_by_label?: Record<string, number> }>}
 */
export async function classifyDocumentFromOcrText({ text, labels, threshold }) {
  const base = String(import.meta.env.VITE_DOC_CLASSIFIER_URL || '').trim().replace(/\/+$/, '')
  // Debug helper: keep a breadcrumb in the console if env injection is missing.
  if (!base) {
    console.warn('[classifyDocumentFromOcrText] missing VITE_DOC_CLASSIFIER_URL', {
      VITE_DOC_CLASSIFIER_URL: import.meta.env.VITE_DOC_CLASSIFIER_URL,
      MODE: import.meta.env.MODE,
    })
  }
  if (!base) {
    throw new Error(
      'Document classifier is not configured. Set VITE_DOC_CLASSIFIER_URL in .env (e.g. http://127.0.0.1:8008) and restart the dev server.',
    )
  }
  let res
  try {
    res = await fetch(`${base}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: typeof text === 'string' ? text : '',
        labels: Array.isArray(labels) ? labels : undefined,
        threshold: typeof threshold === 'number' ? threshold : undefined,
      }),
    })
  } catch (e) {
    throw new Error(
      `Could not reach classifier at ${base}/classify. Is the Python server running? (${e?.message ?? String(e)})`,
    )
  }
  if (!res.ok) {
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

