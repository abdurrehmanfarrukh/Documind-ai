/** @typedef {{ category: string; confidence: number; scores_by_label?: Record<string, number> }} ClassifyResult */

const DEFAULT_LABELS = ['invoice', 'receipt', 'id card', 'report']

const KEYWORD_GROUPS = {
  invoice: [
    'invoice',
    'invoice no',
    'invoice number',
    'bill to',
    'billed to',
    'tax invoice',
    'vat',
    'gst',
    'subtotal',
    'total due',
    'amount due',
    'balance due',
    'due date',
    'terms',
    'purchase order',
    'po number',
  ],
  receipt: [
    'receipt',
    'thank you for your purchase',
    'cashier',
    'change',
    'tender',
    'subtotal',
    'total',
    'card',
    'visa',
    'mastercard',
    'amex',
    'store',
    'terminal',
    'auth code',
  ],
  'id card': [
    'id card',
    'identity',
    'identity card',
    'national identity',
    'date of birth',
    'dob',
    'nationality',
    'issued',
    'expires',
    'expiry',
    'sex',
    'gender',
    'height',
    'address',
    'signature',
    'cnic',
    'nic',
    'citizen',
    'father name',
    'country of stay',
    'pakistan',
  ],
  report: [
    'report',
    'executive summary',
    'introduction',
    'methodology',
    'results',
    'findings',
    'conclusion',
    'references',
    'appendix',
    'table of contents',
  ],
}

/** @param {string} text @param {string[]} words */
function countAny(text, words) {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0)
}

/**
 * Free in-browser classifier (same keyword rules as the Python service).
 * No server, no API key, works on Vercel.
 *
 * @param {string} text
 * @param {{ threshold?: number }} [options]
 * @returns {ClassifyResult | null} null when there is not enough keyword evidence
 */
export function classifyByKeywords(text, { threshold = 0.6 } = {}) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) {
    return { category: 'unknown', confidence: 0, scores_by_label: {} }
  }

  /** @type {Record<string, number>} */
  const scores = {}
  for (const label of DEFAULT_LABELS) {
    scores[label] = countAny(t, KEYWORD_GROUPS[label] ?? [])
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [bestLabel, bestHits] = ranked[0] ?? ['unknown', 0]

  if (bestHits < 2) return null

  const sortedHits = ranked.map(([, hits]) => hits)
  if (sortedHits.length >= 2 && sortedHits[0] === sortedHits[1] && sortedHits[0] >= 2) {
    return null
  }

  const confidence = bestHits === 2 ? 0.75 : bestHits === 3 ? 0.85 : 0.92
  const category = confidence < threshold ? 'unknown' : bestLabel

  return {
    category,
    confidence,
    scores_by_label: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [k, Number(v)]),
    ),
  }
}
