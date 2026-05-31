import { normalizeStoragePath, resolveUserFileBlob } from './resolveUserFileBlob'

function scheduleRevokeObjectUrl(objectUrl, a, delayMs) {
  setTimeout(() => {
    try {
      a.remove()
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(objectUrl)
  }, delayMs)
}

function triggerBlobDownload(blob, fileName, revokeDelayMs = 30_000) {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = fileName || 'download'
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  scheduleRevokeObjectUrl(objectUrl, a, revokeDelayMs)
}

function safeFileName(name) {
  const s = (name || 'download').trim() || 'download'
  return s.replace(/[/\\?%*:|"<>]/g, '_')
}

/**
 * Download from Firebase Storage using the same resolution path as Library/OCR, then save original bytes.
 *
 * On Chromium, {@link window.showSaveFilePicker} runs **before** any network call so the save
 * dialog still counts as user-initiated. When the picker is unavailable, opens the signed
 * `fileUrl` in a new tab first (same gesture) so the file is reachable even if local blob save is blocked.
 *
 * @param {{ storagePath?: string; fileUrl?: string; fileName: string }} params
 */
export async function downloadUploadedFile({ storagePath, fileUrl, fileName }) {
  const path = normalizeStoragePath(storagePath)
  const displayName = (fileName || 'download').trim() || 'download'
  const suggestedName = safeFileName(displayName)

  const canUseSavePicker =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.showSaveFilePicker === 'function'

  /** @type {FileSystemFileHandle | null} */
  let saveHandle = null
  if (canUseSavePicker) {
    try {
      saveHandle = await window.showSaveFilePicker({
        suggestedName,
      })
    } catch {
      saveHandle = null
    }
  }

  let openedTab = false
  if (!canUseSavePicker && typeof window !== 'undefined' && fileUrl) {
    const w = window.open(fileUrl, '_blank', 'noopener,noreferrer')
    openedTab = Boolean(w)
  }

  const blob = await resolveUserFileBlob(path || '', fileUrl)

  if (saveHandle) {
    const writable = await saveHandle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }

  triggerBlobDownload(blob, suggestedName, 30_000)

  if (!openedTab && fileUrl && typeof window !== 'undefined') {
    window.open(fileUrl, '_blank', 'noopener,noreferrer')
  }
}
