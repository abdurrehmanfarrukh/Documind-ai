import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { resolveUserFileBlob, normalizeStoragePath } from './resolveUserFileBlob'
import { deleteStorageObject } from './deleteStorageObject'

/**
 * Move a user's Storage object into a category "folder" (prefix) by downloading + re-uploading.
 * This runs client-side, so it requires Storage CORS and will use bandwidth for the copy.
 *
 * New path shape:
 *   users/{uid}/{category}/{timestamp}_{safeFileName}
 *
 * @param {{
 *  uid: string;
 *  storagePath: string;
 *  fileUrl?: string;
 *  fileName: string;
 *  category: string;
 * }} args
 * @returns {Promise<{ newStoragePath: string; newFileUrl: string }>}
 */
export async function moveUserFileToCategoryFolder({
  uid,
  storagePath,
  fileUrl,
  fileName,
  category,
}) {
  if (!storage) throw new Error('Firebase Storage is not configured.')
  if (!uid) throw new Error('Missing uid.')
  if (!fileName) throw new Error('Missing fileName.')

  const srcPath = normalizeStoragePath(storagePath)
  if (!srcPath) throw new Error('Missing source storagePath.')

  const safeCategory = String(category || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const finalCategory = safeCategory || 'unknown'

  const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file'
  const newStoragePath = `users/${uid}/${finalCategory}/${Date.now()}_${safeName}`

  // Download bytes from the existing object (best-effort: uses fileUrl or path).
  const blob = await resolveUserFileBlob(srcPath, fileUrl)
  if (!blob || blob.size === 0) throw new Error('Could not read the source file bytes from Storage.')

  const destRef = ref(storage, newStoragePath)
  await uploadBytes(destRef, blob, {
    contentType: blob.type || 'application/octet-stream',
  })
  const newFileUrl = await getDownloadURL(destRef)

  // Delete original object after copy succeeds.
  await deleteStorageObject(srcPath)

  return { newStoragePath, newFileUrl }
}

