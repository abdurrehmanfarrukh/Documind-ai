import { normalizeStoragePath, resolveUserFileBlob } from '../storage/resolveUserFileBlob'
import { createWorker } from 'tesseract.js'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js?url'

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
])

/** @param {string | undefined} fileName */
export function fileNameSuggestsImageOcr(fileName) {
  if (!fileName || typeof fileName !== 'string') return false
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''
  return IMAGE_EXTENSIONS.has(ext)
}

/** @param {string | undefined} fileName */
export function fileNameSuggestsPdf(fileName) {
  if (!fileName || typeof fileName !== 'string') return false
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''
  return ext === 'pdf'
}

/** Raster images or PDF (first page is rasterized in-browser before Tesseract). */
export function fileNameSupportsClientOcr(fileName) {
  return fileNameSuggestsImageOcr(fileName) || fileNameSuggestsPdf(fileName)
}

/** @param {Blob} blob */
async function blobLooksLikeRasterImage(blob) {
  const t = (blob.type || '').toLowerCase()
  if (t.startsWith('image/') && !t.includes('svg')) return true
  if (blob.size < 12) return false
  const buf = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
  // WEBP RIFF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true
  return false
}

/** @param {Blob} blob */
async function blobLooksLikePdf(blob) {
  if ((blob.type || '').toLowerCase() === 'application/pdf') return true
  if (blob.size < 5) return false
  const buf = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2f // %PDF/
}

let pdfWorkerSrcConfigured = false

/** Avoid canvas / Leptonica limits; downscale only when needed. */
const MAX_OCR_PIXEL_EDGE = 4096

/**
 * Decode any supported image blob and re-encode as PNG bytes Tesseract/Leptonica reliably read.
 * Tesseract's browser `loadImage` does not handle `ImageBitmap`; passing one produced invalid bytes and "Error attempting to read image."
 *
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
async function ensurePngBlobForTesseract(blob) {
  if (!(blob instanceof Blob) || blob.size < 1) {
    throw new Error('Empty or invalid image for OCR.')
  }
  let bmp
  try {
    bmp = await createImageBitmap(blob)
  } catch (e) {
    const m = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    throw new Error(`Could not decode image for OCR (${m}). Try PNG or JPEG.`)
  }
  try {
    let w = bmp.width
    let h = bmp.height
    if (w < 1 || h < 1) {
      throw new Error('Image has no pixel dimensions.')
    }
    let tw = w
    let th = h
    if (w > MAX_OCR_PIXEL_EDGE || h > MAX_OCR_PIXEL_EDGE) {
      const r = Math.min(MAX_OCR_PIXEL_EDGE / w, MAX_OCR_PIXEL_EDGE / h, 1)
      tw = Math.max(1, Math.floor(w * r))
      th = Math.max(1, Math.floor(h * r))
    }
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable.')
    ctx.drawImage(bmp, 0, 0, tw, th)
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image as PNG for OCR.'))),
        'image/png',
        0.95,
      )
    })
    return png
  } finally {
    try {
      bmp.close?.()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Render PDF page 1 to a PNG blob (pdf.js). Worker URL is set once for Vite.
 * Exported for UI preview; OCR uses the same helper internally when needed.
 *
 * @param {Blob} pdfBlob
 * @param {{ onProgress?: (n: number) => void }} [options]
 */
export async function rasterizePdfFirstPageToPngBlob(pdfBlob, options = {}) {
  const { onProgress } = options
  if (!pdfWorkerSrcConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    pdfWorkerSrcConfigured = true
  }
  onProgress?.(0.02)
  const data = new Uint8Array(await pdfBlob.arrayBuffer()).slice()
  const pdf = await pdfjs.getDocument({ data }).promise
  if (pdf.numPages < 1) {
    throw new Error('PDF has no pages to OCR.')
  }
  onProgress?.(0.08)
  const page = await pdf.getPage(1)
  const base = page.getViewport({ scale: 1 })
  let scale = 2
  if (base.width * scale > MAX_OCR_PIXEL_EDGE || base.height * scale > MAX_OCR_PIXEL_EDGE) {
    scale = Math.min(MAX_OCR_PIXEL_EDGE / base.width, MAX_OCR_PIXEL_EDGE / base.height, 2)
  }
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable for PDF rendering.')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: ctx, viewport }).promise
  onProgress?.(0.18)
  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to rasterize PDF page as PNG.'))),
      'image/png',
      1,
    )
  })
  return pngBlob
}

function tesseractLang() {
  const raw = import.meta.env.VITE_TESSERACT_LANG
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s.length > 0 ? s : 'eng'
}

/** First language segment for @tesseract.js-data CDN paths (e.g. `eng+osd` → `eng`). */
function primaryLangCode(lang) {
  const first = (lang || 'eng').split('+')[0]?.trim() || 'eng'
  return first.replace(/[^a-zA-Z0-9_-]/g, '') || 'eng'
}

/** Pinned folder so the worker can pick the right SIMD/LSTM `.wasm.js` for this device (matches tesseract.js-core 7.x). */
const TESSERACT_CORE_CDN_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0'

function resolveBundledTesseractPaths(lang) {
  const primary = primaryLangCode(lang)
  const envLangPath = import.meta.env.VITE_TESSERACT_LANG_PATH
  const langPath =
    typeof envLangPath === 'string' && envLangPath.trim().length > 0
      ? envLangPath.trim()
      : `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${primary}/4.0.0_best_int`
  return {
    workerPath: tesseractWorkerUrl,
    corePath: tesseractCoreUrl || TESSERACT_CORE_CDN_BASE,
    langPath,
  }
}

/**
 * Run Tesseract.js OCR on an image {@link Blob} (browser; loads WASM on first use).
 *
 * @param {Blob} imageBlob
 * @param {{ onProgress?: (n: number) => void }} [options]
 * @returns {Promise<{ text: string; confidence: number }>}
 */
export async function runOcrOnImageBlob(imageBlob, options = {}) {
  const { onProgress } = options
  const lang = tesseractLang()
  const { workerPath, corePath, langPath } = resolveBundledTesseractPaths(lang)

  const logger = onProgress
    ? (m) => {
        if (typeof m?.progress === 'number') onProgress(Math.round(m.progress * 100) / 100)
      }
    : undefined

  const worker = await createWorker(lang, 1, {
    ...(workerPath ? { workerPath } : {}),
    ...(corePath ? { corePath } : {}),
    langPath,
    /** Avoid blob-wrapped worker; improves compatibility with bundled `workerPath` + `importScripts`. */
    workerBlobURL: false,
    logger,
  })
  try {
    const pngBlob = await ensurePngBlobForTesseract(imageBlob)
    const out = await worker.recognize(pngBlob)
    const data = out?.data ?? out
    const text = typeof data?.text === 'string' ? data.text : ''
    const conf = data?.confidence
    return {
      text: text.trim(),
      confidence: typeof conf === 'number' && !Number.isNaN(conf) ? conf : 0,
    }
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    console.error('[tesseractOcr]', e)
    throw new Error(
      msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')
        ? `OCR failed to load resources (${msg}). Ensure language packs can load (default: jsDelivr). Optional: set VITE_TESSERACT_LANG_PATH in .env to a URL folder with ${primaryLangCode(lang)}.traineddata, or allow cdn.jsdelivr.net.`
        : msg.includes('attempting to read image')
          ? `OCR could not read the image after normalizing it (${msg}). Try another format (PNG/JPEG) or a smaller page.`
          : `OCR failed: ${msg}`,
    )
  } finally {
    await worker.terminate().catch(() => {})
  }
}

/**
 * Fetch a cloud file from Firebase Storage then OCR if it is a raster image.
 *
 * @param {{ storagePath?: string; fileUrl?: string; fileName: string; onProgress?: (n: number) => void; fileBlob?: Blob; ocrImageBlob?: Blob }} p
 */
export async function runOcrOnCloudFile({
  storagePath,
  fileUrl,
  fileName,
  onProgress,
  fileBlob,
  ocrImageBlob,
}) {
  /** Already rasterized (e.g. PDF → PNG for preview); skip fetch/PDF logic and run Tesseract only. */
  if (ocrImageBlob instanceof Blob && ocrImageBlob.size > 0) {
    return runOcrOnImageBlob(ocrImageBlob, { onProgress })
  }

  const path = normalizeStoragePath(storagePath)
  const blob =
    fileBlob instanceof Blob ? fileBlob : await resolveUserFileBlob(path || '', fileUrl)
  const nameImage = fileNameSuggestsImageOcr(fileName)
  const namePdf = fileNameSuggestsPdf(fileName)
  const blobImage = await blobLooksLikeRasterImage(blob)
  const blobPdf = await blobLooksLikePdf(blob)

  if (namePdf || blobPdf) {
    const pngBlob = await rasterizePdfFirstPageToPngBlob(blob, { onProgress })
    return runOcrOnImageBlob(pngBlob, { onProgress })
  }

  if (!nameImage && !blobImage) {
    throw new Error(
      'OCR supports raster images (PNG, JPEG, WebP, GIF, BMP, TIFF) and PDF (first page only). This file type is not supported.',
    )
  }
  return runOcrOnImageBlob(blob, { onProgress })
}
