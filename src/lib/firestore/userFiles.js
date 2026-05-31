import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../firebase'
import { patchMachineIndexText } from '../ocr/buildMachineIndexFromOcr.js'

/** Metadata for each file stored in Firebase Storage */
export const USER_FILES_COLLECTION = 'user_files'

/**
 * Step B: Save download URL and metadata after a successful Storage upload.
 * Uses `auth.currentUser.uid` so the written `uid` always matches the signed-in user (required by rules).
 * @param {{ fileUrl: string; fileName: string; storagePath: string; sizeBytes?: number }} payload
 * @returns {Promise<string>} new document id
 */
export async function saveUserFileRecord({
  fileUrl,
  fileName,
  storagePath,
  sizeBytes,
}) {
  if (!db) throw new Error('Firestore not initialized')
  if (!auth) throw new Error('Firebase Auth not initialized')
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('You must be signed in to save file metadata.')

  const ref = await addDoc(collection(db, USER_FILES_COLLECTION), {
    uid,
    fileUrl,
    fileName,
    storagePath,
    ...(typeof sizeBytes === 'number' && !Number.isNaN(sizeBytes)
      ? { sizeBytes }
      : {}),
    timestamp: serverTimestamp(),
  })
  return ref.id
}

/**
 * Permanently remove a `user_files` metadata document (primary delete from Library).
 * @param {string} docId
 */
export async function deleteUserFileDocument(docId) {
  if (!db) throw new Error('Firestore not initialized')
  if (!auth?.currentUser) throw new Error('You must be signed in.')
  await deleteDoc(doc(db, USER_FILES_COLLECTION, docId))
}

/**
 * Persist machine-readable OCR output on a `user_files` row (for rules, search, folder automation).
 * @param {string} docId Firestore document id
 * @param {Record<string, unknown>} machineIndex stable OCR payload (see `buildMachineIndexFromOcr`).
 */
/** Firestore rejects `undefined` and `NaN`; JSON round-trip normalizes payloads. */
export function sanitizeForFirestoreDocument(value) {
  try {
    return JSON.parse(
      JSON.stringify(value, (_k, v) => {
        if (typeof v === 'number' && Number.isNaN(v)) return null
        return v
      }),
    )
  } catch {
    throw new Error('machineIndex could not be serialized for Firestore.')
  }
}

export async function updateUserFileMachineIndex(docId, machineIndex) {
  if (!db) throw new Error('Firestore not initialized')
  if (!auth?.currentUser) throw new Error('You must be signed in.')
  if (!docId || typeof docId !== 'string') throw new Error('Invalid file id.')
  const safe = sanitizeForFirestoreDocument(machineIndex)
  await updateDoc(doc(db, USER_FILES_COLLECTION, docId), {
    machineIndex: safe,
    machineIndexedAt: serverTimestamp(),
  })
}

/**
 * Update a `user_files` row after moving the underlying Storage object.
 * @param {string} docId
 * @param {{ storagePath: string; fileUrl: string; category?: string; folderId?: string | null; classification?: { category: string; confidence: number; scoresByLabel?: Record<string, number> } }} payload
 */
export async function updateUserFileStorageLocationAndClassification(
  docId,
  { storagePath, fileUrl, category, folderId, classification },
) {
  if (!db) throw new Error('Firestore not initialized')
  if (!auth?.currentUser) throw new Error('You must be signed in.')
  if (!docId || typeof docId !== 'string') throw new Error('Invalid file id.')
  if (!storagePath || typeof storagePath !== 'string') throw new Error('Invalid storagePath.')
  if (!fileUrl || typeof fileUrl !== 'string') throw new Error('Invalid fileUrl.')

  const patch = {
    storagePath,
    fileUrl,
    ...(category && typeof category === 'string' ? { category } : {}),
    ...(folderId === null ? { folderId: null } : {}),
    ...(folderId && typeof folderId === 'string' ? { folderId } : {}),
    ...(classification && typeof classification === 'object'
      ? {
          classification: sanitizeForFirestoreDocument({
            ...classification,
            classifiedAt: new Date().toISOString(),
          }),
        }
      : {}),
    updatedAt: serverTimestamp(),
  }

  await updateDoc(doc(db, USER_FILES_COLLECTION, docId), patch)
}

/**
 * Read-merge-write `machineIndex.text` (and derived metrics) after user edits.
 * Requires an existing `machineIndex` (run OCR in Library first).
 *
 * @param {string} docId `user_files` document id
 * @param {string} newText full replacement text
 * @returns {Promise<Record<string, unknown>>} sanitized `machineIndex` written to Firestore
 */
export async function patchUserFileMachineIndexText(docId, newText) {
  if (!db) throw new Error('Firestore not initialized')
  if (!auth?.currentUser) throw new Error('You must be signed in.')
  if (!docId || typeof docId !== 'string') throw new Error('Invalid file id.')
  const ref = doc(db, USER_FILES_COLLECTION, docId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('File not found.')
  const data = snap.data()
  if (!data.machineIndex || typeof data.machineIndex !== 'object') {
    throw new Error('No OCR text yet. Run OCR on this file in the Library.')
  }
  const merged = patchMachineIndexText(
    data.machineIndex,
    newText,
    typeof data.fileName === 'string' ? data.fileName : '',
  )
  const safe = sanitizeForFirestoreDocument(merged)
  await updateDoc(ref, {
    machineIndex: safe,
    machineIndexedAt: serverTimestamp(),
  })
  return safe
}

/** @param {unknown} ts Firestore Timestamp or plain { seconds } */
export function timestampToMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts.seconds !== undefined) return ts.seconds * 1000
  return 0
}

/**
 * Merge server snapshot with optimistic rows not yet visible on the server (same logic as the listener).
 * @param {Array<{ id: string }>} serverRows
 * @param {Array<{ id?: string; _pendingLocal?: boolean }>} prev
 */
export function mergeServerAndPendingUserFiles(serverRows, prev) {
  const serverIds = new Set(serverRows.map((r) => r.id))
  const pending = (prev ?? []).filter(
    (r) => r && r._pendingLocal && r.id && !serverIds.has(r.id),
  )
  const merged = [...serverRows, ...pending]
  merged.sort(
    (a, b) => timestampToMillis(b.timestamp) - timestampToMillis(a.timestamp),
  )
  return merged
}

/**
 * One-shot read of `user_files` for the signed-in user (fallback if the real-time listener is empty or slow).
 */
export async function fetchUserFilesForCurrentUser() {
  if (!db || !auth?.currentUser) return []
  const uid = auth.currentUser.uid
  const q = query(
    collection(db, USER_FILES_COLLECTION),
    where('uid', '==', uid),
  )
  const snap = await getDocs(q)
  const rows = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }))
  rows.sort(
    (a, b) => timestampToMillis(b.timestamp) - timestampToMillis(a.timestamp),
  )
  return rows
}

/**
 * Step C: Real-time list of all `user_files` for the signed-in user (any device).
 * Uses the same {@link auth} instance as Firestore so the `where('uid', '==', …)` query
 * always matches `request.auth.uid` in security rules.
 * Sorted newest first (client-side so no composite index is required).
 * @param {(rows: Array<{ id: string; uid: string; fileUrl: string; fileName: string; storagePath: string; timestamp: unknown }>, meta?: { clear?: boolean }) => void} onData
 * @param {(err: Error) => void} [onError]
 */
export function subscribeUserFiles(onData, onError) {
  if (!db || !auth) {
    onError?.(new Error('Firestore not initialized'))
    return () => {}
  }
  /** Attach the query after auth is ready — avoids an empty snapshot when `currentUser` is not set yet. */
  let unsubSnapshot = () => {}
  const unsubAuth = onAuthStateChanged(auth, (user) => {
    unsubSnapshot()
    unsubSnapshot = () => {}
    if (!user) {
      onData([], { clear: true })
      return
    }
    const q = query(
      collection(db, USER_FILES_COLLECTION),
      where('uid', '==', user.uid),
    )
    unsubSnapshot = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
        rows.sort((a, b) => timestampToMillis(b.timestamp) - timestampToMillis(a.timestamp))
        onData(rows)
      },
      (err) => onError?.(err),
    )
  })
  return () => {
    unsubAuth()
    unsubSnapshot()
  }
}
