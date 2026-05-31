import { ref, getBlob, getBytes, getDownloadURL } from 'firebase/storage'
import { auth, storage } from '../firebase'

/** HTTP head + body for signed Storage URLs (hangs without timeout on bad networks). */
const FETCH_STORAGE_MS = 45_000
/** Firebase SDK read can stall on some proxies / VPNs. */
const GET_BLOB_MS = 45_000
/** Auth token refresh should finish quickly. */
const GET_ID_TOKEN_MS = 20_000

/** Chrome shows only "Failed to fetch" for CORS / blocked network — replace with something actionable. */
function explainNetworkError(err) {
  if (!err || typeof err !== 'object') return new Error(String(err))
  const name = 'name' in err ? String(err.name) : ''
  const message = 'message' in err ? String(err.message) : String(err)
  const isFailedFetch =
    name === 'TypeError' &&
    (message.includes('Failed to fetch') ||
      message.includes('Load failed') ||
      message.includes('NetworkError'))
  if (isFailedFetch) {
    const raw = storage?.app?.options?.storageBucket ?? ''
    const bucket = raw.replace(/^gs:\/\//, '').trim()
    const gs = bucket ? `gs://${bucket}` : 'gs://YOUR_BUCKET_FROM_FIREBASE_CONSOLE'
    return new Error(
      [
        'Google Cloud Storage is blocking browser downloads (CORS). Even Firebase getBlob uses the same network rules.',
        bucket
          ? `This app is using bucket: ${bucket}`
          : 'Set VITE_FIREBASE_STORAGE_BUCKET in .env to match Firebase Console → Storage.',
        `Fix (one time): install Google Cloud SDK, open a terminal in your project folder, run:`,
        `  gsutil cors set storage-cors.example.json ${gs}`,
        `Or: gcloud storage buckets update ${gs} --cors-file=storage-cors.example.json`,
        `Then hard-refresh the browser (Ctrl+Shift+R). Use Google Cloud Shell if you do not have gsutil locally.`,
      ].join(' '),
    )
  }
  return err instanceof Error ? err : new Error(message)
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} ms
 */
async function fetchWithTimeout(url, init, ms) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e && typeof e === 'object' && e.name === 'AbortError') {
      throw new Error(
        `Download timed out after ${ms / 1000}s (no response from Storage). Check your network, VPN, or firewall.`,
      )
    }
    throw explainNetworkError(e)
  } finally {
    clearTimeout(t)
  }
}

/** @param {string | undefined} p */
export function normalizeStoragePath(p) {
  if (!p || typeof p !== 'string') return ''
  const t = p.trim()
  if (!t) return ''
  if (t.startsWith('gs://')) {
    const m = t.match(/^gs:\/\/[^/]+\/(.+)$/)
    return m?.[1] ?? t
  }
  return t
}

/**
 * Extract object path (`users/…/file`) from Firebase download URLs for use with {@link ref}
 * against the app’s configured {@link storage} bucket.
 * @param {string | undefined} urlString
 */
export function objectPathFromFirebaseDownloadUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return ''
  try {
    const u = new URL(urlString)
    const host = u.hostname.toLowerCase()
    /** New default host: `https://<bucket>.firebasestorage.app/o/...` */
    if (host.endsWith('.firebasestorage.app')) {
      const m = u.pathname.match(/^\/o\/(.+)/i)
      if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '))
    }
    if (host === 'firebasestorage.googleapis.com' || host === 'storage.googleapis.com') {
      const m = u.pathname.match(/\/v0\/b\/[^/]+\/o\/(.+)/i)
      if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '))
    }
    if (host === 'storage.googleapis.com') {
      const m = u.pathname.match(/\/download\/storage\/v1\/b\/[^/]+\/o\/(.+)/i)
      if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '))
    }
  } catch {
    return ''
  }
  return ''
}

/** @param {string | undefined} url */
export function isFirebaseStorageDownloadUrl(url) {
  if (!url || typeof url !== 'string') return false
  const h = url.toLowerCase()
  return (
    h.includes('firebasestorage.googleapis.com') ||
    h.includes('firebasestorage.app') ||
    h.includes('googleapis.com/v0/b/') ||
    h.includes('googleapis.com/download/storage') ||
    h.includes('storage.googleapis.com')
  )
}

/**
 * Try HTTPS download URL first (matches the exact bucket + token from upload).
 * SDK `getBlob` can fail when `VITE_FIREBASE_STORAGE_BUCKET` does not match the bucket in the URL.
 *
 * @param {string} fileUrl
 */
async function tryFetchStorageDownloadUrl(fileUrl) {
  try {
    const res = await fetchWithTimeout(
      fileUrl,
      { mode: 'cors', credentials: 'omit', cache: 'no-store' },
      FETCH_STORAGE_MS,
    )
    if (res.ok) {
      return await withTimeout(
        res.blob(),
        FETCH_STORAGE_MS,
        `Reading the downloaded file stalled after ${FETCH_STORAGE_MS / 1000}s.`,
      )
    }
    /** Some setups return 401/403 until a Firebase ID token is sent (token query param stale or rules-tight). */
    if ((res.status === 403 || res.status === 401) && auth?.currentUser) {
      const token = await auth.currentUser.getIdToken()
      const res2 = await fetchWithTimeout(
        fileUrl,
        {
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        },
        FETCH_STORAGE_MS,
      )
      if (res2.ok) {
        return await withTimeout(
          res2.blob(),
          FETCH_STORAGE_MS,
          `Reading the downloaded file stalled after ${FETCH_STORAGE_MS / 1000}s.`,
        )
      }
    }
    return null
  } catch (e) {
    const ex = explainNetworkError(e)
    console.warn('[resolveUserFileBlob] fetch download URL failed', ex.message)
    return null
  }
}

/**
 * Download via Storage REST `alt=media` + Firebase ID token (honors security rules; works when stored URL token is stale).
 * @param {string} objectPath e.g. `users/uid/123_file.pdf`
 */
async function tryAuthenticatedRestDownload(objectPath) {
  if (!storage || !objectPath || !auth?.currentUser) return null
  const bucket = storage.app.options.storageBucket
  if (!bucket) return null
  const bucketName = bucket.replace(/^gs:\/\//, '')
  let token
  try {
    token = await auth.currentUser.getIdToken()
  } catch {
    return null
  }
  const enc = encodeURIComponent(objectPath)
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${enc}?alt=media`
  try {
    const res = await fetchWithTimeout(
      url,
      {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      },
      FETCH_STORAGE_MS,
    )
    if (!res.ok) {
      console.warn(
        '[resolveUserFileBlob] REST alt=media',
        res.status,
        objectPath.slice(0, 80),
      )
      return null
    }
    const b = await withTimeout(
      res.blob(),
      FETCH_STORAGE_MS,
      `Reading the downloaded file stalled after ${FETCH_STORAGE_MS / 1000}s.`,
    )
    return b instanceof Blob && b.size > 0 ? b : null
  } catch (e) {
    const ex = explainNetworkError(e)
    console.warn('[resolveUserFileBlob] REST download failed', objectPath.slice(0, 80), ex.message)
    return null
  }
}

/**
 * @param {string} objectPath
 */
async function readObjectAsBlob(objectPath) {
  if (!storage || !objectPath) throw new Error('Missing Storage or path.')
  const r = ref(storage, objectPath)
  try {
    return await withTimeout(
      getBlob(r),
      GET_BLOB_MS,
      `Firebase Storage getBlob timed out after ${GET_BLOB_MS / 1000}s.`,
    )
  } catch (e) {
    console.warn('[resolveUserFileBlob] getBlob failed, trying getBytes', e)
    try {
      const bytes = await withTimeout(
        getBytes(r),
        GET_BLOB_MS,
        `Firebase Storage getBytes timed out after ${GET_BLOB_MS / 1000}s.`,
      )
      return new Blob([bytes], { type: 'application/octet-stream' })
    } catch (e2) {
      throw explainNetworkError(e2)
    }
  }
}

/**
 * Load bytes for a cloud file using Firestore metadata (`storagePath`, `fileUrl`).
 * Refreshes the auth token first so Storage rules see a signed-in user.
 *
 * @param {string} pathFromMeta
 * @param {string | undefined} fileUrl
 * @returns {Promise<Blob>}
 */
export async function resolveUserFileBlob(pathFromMeta, fileUrl) {
  if (auth?.currentUser) {
    try {
      await withTimeout(
        auth.currentUser.getIdToken(true),
        GET_ID_TOKEN_MS,
        'Refreshing your session timed out. Try signing out and back in.',
      )
    } catch {
      try {
        await auth.currentUser.getIdToken()
      } catch {
        /* ignore */
      }
    }
  }

  const normalizedPath = normalizeStoragePath(pathFromMeta)
  const pathFromUrl = objectPathFromFirebaseDownloadUrl(
    typeof fileUrl === 'string' ? fileUrl : '',
  )
  const candidates = [...new Set([normalizedPath, pathFromUrl].filter(Boolean))]
  const primaryObjectPath = candidates[0] ?? ''

  /**
   * Prefer SDK + REST with Bearer **before** plain fetch(downloadURL): raw Google URLs often hit
   * strict CORS on localhost while the Firebase client uses authenticated channels.
   */
  if (storage && auth?.currentUser) {
    for (const objectPath of candidates) {
      try {
        const b = await readObjectAsBlob(objectPath)
        if (b instanceof Blob && b.size > 0) return b
      } catch (e) {
        console.warn('[resolveUserFileBlob] read object failed for path', objectPath, e)
      }
      const restBlob = await tryAuthenticatedRestDownload(objectPath)
      if (restBlob) return restBlob
    }
  }

  /**
   * `fileUrl` in Firestore can go stale if the object was replaced (new download token).
   * Fresh URL + fetch after SDK attempts.
   */
  if (storage && primaryObjectPath && auth?.currentUser) {
    try {
      const freshUrl = await getDownloadURL(ref(storage, primaryObjectPath))
      const fromFresh = await tryFetchStorageDownloadUrl(freshUrl)
      if (fromFresh instanceof Blob && fromFresh.size > 0) return fromFresh
    } catch (e) {
      console.warn('[resolveUserFileBlob] getDownloadURL + fetch failed', e)
    }
  }

  /** Stored download URL from Firestore (may be stale; fetch never throws — see tryFetch). */
  if (fileUrl && typeof fileUrl === 'string' && /^https?:\/\//i.test(fileUrl.trim())) {
    const fromFetch = await tryFetchStorageDownloadUrl(fileUrl.trim())
    if (fromFetch instanceof Blob && fromFetch.size > 0) return fromFetch
  }

  if (fileUrl && storage && isFirebaseStorageDownloadUrl(fileUrl)) {
    try {
      const b = await withTimeout(
        getBlob(ref(storage, fileUrl)),
        GET_BLOB_MS,
        `Firebase getBlob (full URL) timed out after ${GET_BLOB_MS / 1000}s.`,
      )
      if (b instanceof Blob && b.size > 0) return b
    } catch (e) {
      console.warn('[resolveUserFileBlob] getBlob(ref, fullUrl) failed', e)
    }
  }

  if (fileUrl && typeof fileUrl === 'string' && /^https?:\/\//i.test(fileUrl.trim())) {
    try {
      const url = fileUrl.trim()
      const res = await fetchWithTimeout(
        url,
        { mode: 'cors', credentials: 'omit', cache: 'no-store' },
        FETCH_STORAGE_MS,
      )
      if (res.ok) {
        const b = await withTimeout(
          res.blob(),
          FETCH_STORAGE_MS,
          `Reading the downloaded file stalled after ${FETCH_STORAGE_MS / 1000}s.`,
        )
        if (b.size > 0) return b
        throw new Error('File in Storage is empty (0 bytes).')
      }
      throw new Error(
        res.status === 404
          ? 'File not found in Storage (404). It may have been removed, or the download link is invalid.'
          : `Could not download file from Storage (${res.status}). Verify Storage rules allow read for users/{yourUid}/** and that VITE_FIREBASE_STORAGE_BUCKET matches your project bucket.`,
      )
    } catch (e) {
      throw explainNetworkError(e)
    }
  }

  throw new Error(
    'Could not read the file from Storage. Sign in, deploy rules for users/{uid}/**, ensure VITE_FIREBASE_STORAGE_BUCKET matches Firebase Console, and set bucket CORS for http://localhost:5173 if the console shows a CORS error.',
  )
}

const EXT_TO_DISPLAY_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

/**
 * Firebase {@link getBlob} / {@link getBytes} often yields `application/octet-stream`, which breaks
 * PDF/image preview in iframes and `<img>`. Clone with a concrete type when we can infer it.
 *
 * @param {Blob} blob
 * @param {string | undefined} fileName
 * @returns {Promise<Blob>}
 */
export async function coerceStorageBlobForNativePreview(blob, fileName) {
  const name = (fileName || '').toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  let desired = ext ? EXT_TO_DISPLAY_MIME[ext] : ''

  if (!desired && blob.size >= 5) {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2f) {
      desired = 'application/pdf'
    } else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      desired = 'image/jpeg'
    } else if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      desired = 'image/png'
    }
  }

  if (!desired) return blob

  const cur = (blob.type || '').toLowerCase().trim()
  if (cur === desired) return blob
  if (desired === 'image/jpeg' && (cur === 'image/jpg' || cur === 'image/pjpeg')) return blob
  if (
    cur &&
    cur !== 'application/octet-stream' &&
    cur !== 'binary/octet-stream' &&
    !cur.startsWith('text/')
  ) {
    return blob
  }

  try {
    return new Blob([blob], { type: desired })
  } catch {
    return blob
  }
}
