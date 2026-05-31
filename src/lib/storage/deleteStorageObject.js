import { ref, deleteObject } from 'firebase/storage'
import { storage } from '../firebase'

/**
 * Remove an object from Firebase Storage (requires auth; rules must allow delete).
 * @param {string} storagePath
 */
export async function deleteStorageObject(storagePath) {
  if (!storage) throw new Error('Firebase Storage is not configured.')
  if (!storagePath) return
  await deleteObject(ref(storage, storagePath))
}
