/** @typedef {{ category: string; confidence: number; scores_by_label?: Record<string, number> }} ClassifyResult */

const DEFAULT_LABELS = ['invoice', 'receipt', 'id card', 'report']

/** One match is enough for these high-signal phrases. */
const STRONG_PHRASES = {
  'id card': [
    'national identity card',
    'identity card',
    'id card',
    'cnic',
    'nadra',
    'national identity',
  ],
  invoice: ['tax invoice', 'invoice number', 'invoice no', 'bill to', 'billed to'],
  receipt: ['thank you for your purchase', 'auth code'],
  report: ['executive summary', 'table of contents'],
}

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
    'purchase order',
    'po number',
  ],
  receipt: [
    'receipt',
    'thank you for your purchase',
    'cashier',
    'change',
    'tender',
    'visa',
    'mastercard',
    'amex',
    'terminal',
    'auth code',
    'merchant',
    'paid',
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
    'signature',
    'cnic',
    'nic',
    'citizen',
    'father name',
    'father',
    'country of stay',
    'pakistan',
    'validity',
    'date of issue',
    'holder',
    'passport',
    'license',
    'licence',
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

/** @param {string} text */
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s/@.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** @param {string} text @param {string[]} words */
function countAny(text, words) {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0)
}

/** @param {string} text @param {string[]} phrases */
function hasStrongPhrase(text, phrases) {
  return phrases.some((p) => text.includes(p))
}

/** @param {string | undefined} fileName */
export function classifyByFileName(fileName) {
  const name = normalizeText(fileName || '').replace(/\./g, ' ')
  if (!name) return null

  if (
    /\bcnic\b/.test(name) ||
    /\bnadra\b/.test(name) ||
    /\bnational identity\b/.test(name) ||
    /\bid card\b/.test(name) ||
    /\bidentity card\b/.test(name) ||
    /\bpassport\b/.test(name) ||
    /\bnic\b/.test(name)
  ) {
    return { category: 'id card', confidence: 0.8, scores_by_label: { 'id card': 3 } }
  }
  if (/\binvoice\b/.test(name) || /\binv\b/.test(name)) {
    return { category: 'invoice', confidence: 0.8, scores_by_label: { invoice: 3 } }
  }
  if (/\breceipt\b/.test(name)) {
    return { category: 'receipt', confidence: 0.8, scores_by_label: { receipt: 3 } }
  }
  if (/\breport\b/.test(name)) {
    return { category: 'report', confidence: 0.8, scores_by_label: { report: 3 } }
  }
  return null
}

/**
 * Free in-browser classifier (keyword rules + optional filename hints).
 *
 * @param {string} text
 * @param {{ threshold?: number; fileName?: string }} [options]
 * @returns {ClassifyResult}
 */
export function classifyByKeywords(text, { threshold = 0.6, fileName } = {}) {
  const fileHint = classifyByFileName(fileName)
  const t = normalizeText(text)
  if (!t) {
    return fileHint ?? { category: 'unknown', confidence: 0, scores_by_label: {} }
  }

  /** @type {Record<string, number>} */
  const scores = {}
  for (const label of DEFAULT_LABELS) {
    scores[label] = countAny(t, KEYWORD_GROUPS[label] ?? [])
  }

  for (const [label, phrases] of Object.entries(STRONG_PHRASES)) {
    if (hasStrongPhrase(t, phrases)) {
      scores[label] = Math.max(scores[label] ?? 0, 3)
    }
  }

  if (fileHint) {
    scores[fileHint.category] = Math.max(scores[fileHint.category] ?? 0, 2)
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [bestLabel, bestHits] = ranked[0] ?? ['unknown', 0]
  const secondHits = ranked[1]?.[1] ?? 0

  if (bestHits < 1) {
    return fileHint ?? { category: 'unknown', confidence: 0, scores_by_label: scores }
  }

  // Prefer a clear winner; allow 1 hit when nothing else matched.
  if (bestHits < 2 && secondHits > 0 && bestHits === secondHits) {
    return fileHint ?? { category: 'unknown', confidence: 0.4, scores_by_label: scores }
  }

  const confidence =
    bestHits >= 4 ? 0.92 : bestHits === 3 ? 0.85 : bestHits === 2 ? 0.75 : 0.65
  const category = confidence < threshold ? 'unknown' : bestLabel

  if (category === 'unknown' && fileHint) {
    return { ...fileHint, scores_by_label: scores }
  }

  return {
    category,
    confidence: category === 'unknown' ? confidence : confidence,
    scores_by_label: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [k, Number(v)]),
    ),
  }
}
