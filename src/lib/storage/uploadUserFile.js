import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { auth, storage } from '../firebase'

/**
 * Sanitize original filename for safe Storage object keys.
 * @param {string} name
 */
function safeFileName(name) {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return base.length > 0 ? base : 'file'
}

/**
 * @param {import('firebase/storage').FirebaseStorageError | Error} err
 */
function storageErrorMessage(err) {
  const code = err && 'code' in err ? String(err.code) : ''
  if (code === 'storage/unauthorized')
    return 'Storage denied this upload. Deploy storage.rules (users/{uid}/** for the signed-in user) in Firebase Console → Storage → Rules.'
  if (code === 'storage/canceled') return 'Upload was canceled.'
  if (code === 'storage/invalid-checksum') return 'File checksum failed. Try again.'
  if (code === 'storage/retry-limit-exceeded') return 'Upload failed after retries. Check your connection.'
  if (code === 'storage/quota-exceeded') return 'Storage quota exceeded for this project.'
  if (code === 'storage/unauthenticated')
    return 'You are not signed in. Sign in again, then retry the upload.'
  return err?.message ?? 'Upload failed.'
}

/**
 * Upload a file to Firebase Storage. Path: `users/{uid}/{timestamp}_{filename}`.
 * @param {string} uid
 * @param {File} file
 * @param {(percent: number) => void} [onProgress] 0–100
 * @returns {Promise<{ downloadURL: string; storagePath: string; fileName: string }>}
 */
export async function uploadUserFile(uid, file, onProgress) {
  if (!storage) {
    throw new Error(
      'Firebase Storage is not ready. Set VITE_FIREBASE_STORAGE_BUCKET in .env to the exact bucket from Firebase (Project settings → Your apps), enable Storage, deploy storage.rules, then restart the dev server.',
    )
  }
  if (!auth) {
    throw new Error('Firebase Auth is not initialized.')
  }
  if (!auth.currentUser) {
    throw new Error('You must be signed in to upload files.')
  }
  if (auth.currentUser.uid !== uid) {
    throw new Error('Session mismatch. Sign out and sign in again.')
  }
  await auth.currentUser.getIdToken(true)

  const safe = safeFileName(file.name)
  const storagePath = `users/${uid}/${Date.now()}_${safe}`
  const storageRef = ref(storage, storagePath)
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
  })

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        const pct =
          snapshot.totalBytes > 0
            ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            : 0
        onProgress?.(Math.round(pct * 100) / 100)
      },
      (err) => reject(new Error(storageErrorMessage(err))),
      async () => {
        /** Last `state_changed` may stop before 90% — move UI to "finalizing" while we resolve the download URL. */
        onProgress?.(95)
        const downloadURL = await getDownloadURL(task.snapshot.ref)
        resolve({
          downloadURL,
          storagePath,
          fileName: file.name,
        })
      },
    )
  })
}
