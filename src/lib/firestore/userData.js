import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/** One document per Firebase Auth user: `userData/{uid}` */
export const USER_DATA_COLLECTION = 'userData'

export function userDataDocRef(uid) {
  if (!db) throw new Error('Firestore not initialized')
  return doc(db, USER_DATA_COLLECTION, uid)
}

function defaultUserData() {
  return {
    isNewUser: true,
    files: [],
    folders: [],
    queue: [],
    updatedAt: serverTimestamp(),
  }
}

/**
 * Ensure a document exists (call after sign-in if needed).
 * @param {string} uid
 */
export async function ensureUserDataDocument(uid) {
  const ref = userDataDocRef(uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, defaultUserData())
  }
}

/**
 * Subscribe to user app data. Creates the doc on first subscribe if missing.
 * @param {string} uid
 * @param {(data: object) => void} onData
 * @param {(err: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeUserData(uid, onData, onError) {
  if (!db) {
    onError?.(new Error('Firestore not initialized'))
    return () => {}
  }
  const ref = userDataDocRef(uid)
  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        setDoc(ref, defaultUserData()).catch((err) => onError?.(err))
        return
      }
      onData(snapshot.data())
    },
    (err) => onError?.(err),
  )
}

/**
 * Merge partial fields into the user doc. Uses setDoc(merge) so it works even
 * if the document was not created yet (avoids updateDoc "not found" errors).
 * @param {string} uid
 * @param {Partial<{ isNewUser: boolean; files: unknown[]; folders: unknown[]; queue: unknown[] }>} patch
 */
export async function patchUserData(uid, patch) {
  const ref = userDataDocRef(uid)
  await setDoc(
    ref,
    {
      ...patch,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/**
 * Attach the same `machineIndex` object to the workspace mirror row (`id` cloud-{docId} or matching `storageDocId`).
 * No-op if there is no mirror yet (Library still works from `user_files`).
 *
 * @param {string} uid
 * @param {string} storageDocId `user_files` document id
 * @param {Record<string, unknown>} machineIndex
 */
export async function mergeCloudFileMachineIndexIntoUserData(uid, storageDocId, machineIndex) {
  const ref = userDataDocRef(uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const data = snap.data()
  const files = Array.isArray(data.files) ? data.files : []
  const cloudId = `cloud-${storageDocId}`
  let found = false
  const next = files.map((f) => {
    if (!f || typeof f !== 'object') return f
    if (f.id === cloudId || f.storageDocId === storageDocId) {
      found = true
      const { _awaitingServerEcho, ...rest } = f
      return { ...rest, machineIndex }
    }
    return f
  })
  if (!found) return
  await patchUserData(uid, { files: next })
}

/** Seed sample folders/files for returning users with empty library. */
export function buildDemoSeed() {
  const now = new Date().toISOString()
  const f1 = crypto.randomUUID()
  const f2 = crypto.randomUUID()
  return {
    folders: [
      { id: f1, name: 'Finance', createdAt: now },
      { id: f2, name: 'Legal', createdAt: now },
    ],
    files: [
      {
        id: crypto.randomUUID(),
        name: 'inv-2023-01',
        ext: 'pdf',
        mime: 'application/pdf',
        size: 2400000,
        folderId: f1,
        type: 'invoice',
        confidence: 98,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        name: 'Contract_Q3',
        ext: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 890000,
        folderId: f2,
        type: 'contract',
        confidence: 92,
        createdAt: now,
      },
    ],
  }
}
