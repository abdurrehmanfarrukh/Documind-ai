import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import mammoth from 'mammoth'

const A4_W = 595.28
const A4_H = 841.88
const MARGIN = 48
const MAX_TEXT_CHARS = 400_000

/** @param {string} originalName */
function derivePdfFileName(originalName) {
  const trimmed = originalName.trim() || 'document'
  const base = trimmed.replace(/\.[^/.]+$/i, '') || 'document'
  return `${base}.pdf`
}

/**
 * @param {string} text
 * @param {import('pdf-lib').PDFFont} font
 * @param {number} fontSize
 * @param {number} maxWidth
 */
function wrapLines(text, font, fontSize, maxWidth) {
  const paragraphs = text.split(/\r?\n/)
  /** @type {string[]} */
  const lines = []
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('')
      continue
    }
    const words = para.split(/\s+/)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        line = word
        continue
      }
      let chunk = ''
      for (const ch of word) {
        const next = chunk + ch
        if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) chunk = next
        else {
          if (chunk) lines.push(chunk)
          chunk = ch
        }
      }
      line = chunk
    }
    if (line) lines.push(line)
  }
  return lines
}

/**
 * @param {PDFDocument} pdfDoc
 * @param {string} text
 */
async function appendTextAsPages(pdfDoc, text) {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontSize = 11
  const lineHeight = fontSize * 1.25
  const maxWidth = A4_W - 2 * MARGIN
  const body =
    text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated after ${MAX_TEXT_CHARS} characters]`
      : text
  const lines = wrapLines(body, font, fontSize, maxWidth)
  let page = pdfDoc.addPage([A4_W, A4_H])
  let y = page.getHeight() - MARGIN
  for (const line of lines) {
    if (y < MARGIN + lineHeight) {
      page = pdfDoc.addPage([A4_W, A4_H])
      y = page.getHeight() - MARGIN
    }
    page.drawText(line, {
      x: MARGIN,
      y: y - fontSize,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.12),
    })
    y -= lineHeight
  }
}

/**
 * Raster formats not handled by embedJpg/embedPng are painted via canvas.
 * @param {File} file
 */
async function fileToPngBytes(file) {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read image data.')
  ctx.drawImage(bmp, 0, 0)
  if (typeof bmp.close === 'function') bmp.close()
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image export failed.'))), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * @param {PDFDocument} pdfDoc
 * @param {File} file
 */
async function appendImageAsPage(pdfDoc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = (file.type || '').toLowerCase()
  const lower = file.name.toLowerCase()

  /** @type {import('pdf-lib').PDFImage} */
  let embedded
  try {
    if (mime.includes('png') || lower.endsWith('.png')) {
      embedded = await pdfDoc.embedPng(bytes)
    } else if (mime.includes('jpeg') || mime.includes('jpg') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      embedded = await pdfDoc.embedJpg(bytes)
    } else {
      const pngBytes = await fileToPngBytes(file)
      embedded = await pdfDoc.embedPng(pngBytes)
    }
  } catch {
    const pngBytes = await fileToPngBytes(file)
    embedded = await pdfDoc.embedPng(pngBytes)
  }

  const scale = embedded.scale(1)
  const iw = scale.width
  const ih = scale.height
  const maxW = A4_W - 2 * MARGIN
  const maxH = A4_H - 2 * MARGIN
  const s = Math.min(maxW / iw, maxH / ih, 1)
  const w = iw * s
  const h = ih * s
  const page = pdfDoc.addPage([A4_W, A4_H])
  page.drawImage(embedded, {
    x: (A4_W - w) / 2,
    y: (A4_H - h) / 2,
    width: w,
    height: h,
  })
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'log',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'c',
  'h',
  'cpp',
  'py',
  'java',
  'yml',
  'yaml',
  'env',
  'sh',
  'bat',
  'ps1',
])

function looksTextLike(bytes) {
  let printable = 0
  const n = Math.min(bytes.length, 8000)
  if (n === 0) return true
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++
  }
  return printable / n > 0.92
}

/**
 * Convert a user file to a single PDF `File` for Storage upload.
 * PDFs pass through unchanged. Images, plain text, and DOCX are converted client-side.
 * Legacy `.doc` and many binary formats cannot be converted in-browser — callers should surface the error.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function convertFileToPdf(file) {
  const mime = (file.type || '').toLowerCase()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (mime === 'application/pdf' || ext === 'pdf') {
    return file
  }

  if (mime === 'application/msword' || ext === 'doc') {
    throw new Error(
      'Legacy Word .doc files cannot be converted in the browser. Save as .docx or PDF, then upload again.',
    )
  }

  const pdfDoc = await PDFDocument.create()

  if (mime.startsWith('image/')) {
    await appendImageAsPage(pdfDoc, file)
    const out = await pdfDoc.save()
    return new File([out], derivePdfFileName(file.name), { type: 'application/pdf' })
  }

  const isDocx =
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx'
  if (isDocx) {
    const buf = await file.arrayBuffer()
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
    await appendTextAsPages(pdfDoc, value || '(empty document)')
    const out = await pdfDoc.save()
    return new File([out], derivePdfFileName(file.name), { type: 'application/pdf' })
  }

  const isPlainText =
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    TEXT_EXTENSIONS.has(ext)

  if (isPlainText) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    await appendTextAsPages(pdfDoc, text)
    const out = await pdfDoc.save()
    return new File([out], derivePdfFileName(file.name), { type: 'application/pdf' })
  }

  /** Last resort: tiny files that look like UTF-8 text become a PDF page. */
  if (file.size <= 2 * 1024 * 1024) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (looksTextLike(bytes)) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      await appendTextAsPages(pdfDoc, text)
      const out = await pdfDoc.save()
      return new File([out], derivePdfFileName(file.name), { type: 'application/pdf' })
    }
  }

  throw new Error(
    `Cannot convert "${file.name}" to PDF here. Supported: PDF, images, text-like files, and DOCX. For other formats, export or print to PDF locally, then upload.`,
  )
}
