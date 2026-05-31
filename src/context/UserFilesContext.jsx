import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from './AuthContext'
import { useAppData } from './AppDataContext'
import { uploadUserFile } from '../lib/storage/uploadUserFile'
import {
  saveUserFileRecord,
  subscribeUserFiles,
  fetchUserFilesForCurrentUser,
  mergeServerAndPendingUserFiles,
  timestampToMillis,
  deleteUserFileDocument,
  updateUserFileMachineIndex,
  patchUserFileMachineIndexText,
  sanitizeForFirestoreDocument,
} from '../lib/firestore/userFiles'
import { mergeCloudFileMachineIndexIntoUserData } from '../lib/firestore/userData'
import { deleteStorageObject } from '../lib/storage/deleteStorageObject'
import { removeHiddenCloudDocId } from '../lib/dashboardHiddenCloudIds'

const UserFilesContext = createContext(null)

/** Drop rows whose Firestore doc was just deleted (guards against stale listener merges). */
function filterOutDeletedUserFileDocs(rows, deletedIds) {
  if (!deletedIds.size) return rows
  return rows.filter((r) => r && !deletedIds.has(r.id))
}

export function UserFilesProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const { markUserNotNew, registerUploadedCloudFile, deleteFile: deleteWorkspaceFile } =
    useAppData()
  const uid = user?.id ?? null

  const [userFiles, setUserFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const deletedUserFileDocIdsRef = useRef(/** @type {Set<string>} */ (new Set()))

  useEffect(() => {
    if (!isAuthenticated || !uid) {
      deletedUserFileDocIdsRef.current.clear()
      setUserFiles([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const unsub = subscribeUserFiles(
      (rows, meta) => {
        if (meta?.clear) {
          deletedUserFileDocIdsRef.current.clear()
          setUserFiles([])
          setLoading(false)
          setError(null)
          return
        }
        /** Do not replace the whole list with an empty/stale snapshot — that hid uploads in Library/Dashboard. */
        setUserFiles((prev) =>
          filterOutDeletedUserFileDocs(
            mergeServerAndPendingUserFiles(rows, prev),
            deletedUserFileDocIdsRef.current,
          ),
        )
        setLoading(false)
        setError(null)
      },
      (err) => {
        console.error('[user_files]', err)
        setError(err?.message ?? 'Could not load your files.')
        setLoading(false)
      },
    )
    return () => unsub()
  }, [isAuthenticated, uid])

  /**
   * Step A + B: upload to Storage, then write `user_files` doc with download URL.
   * @param {File} file
   * @param {(percent: number) => void} [onProgress]
   */
  const uploadFileToFirebase = useCallback(
    async (file, onProgress) => {
      if (!uid) throw new Error('Not signed in.')
      const { downloadURL, storagePath, fileName } = await uploadUserFile(uid, file, onProgress)
      /** Saving Firestore metadata (Library list) — stay in FINALIZING until `onProgress(100)` below. */
      onProgress?.(97)
      try {
        const docId = await saveUserFileRecord({
          fileUrl: downloadURL,
          fileName,
          storagePath,
          sizeBytes: typeof file.size === 'number' ? file.size : undefined,
        })
        setUserFiles((prev) => {
          if (prev.some((r) => r.id === docId)) return prev
          const optimistic = {
            id: docId,
            uid,
            fileUrl: downloadURL,
            fileName,
            storagePath,
            ...(typeof file.size === 'number' ? { sizeBytes: file.size } : {}),
            timestamp: Timestamp.now(),
            _pendingLocal: true,
          }
          return [optimistic, ...prev].sort(
            (a, b) => timestampToMillis(b.timestamp) - timestampToMillis(a.timestamp),
          )
        })
        fetchUserFilesForCurrentUser()
          .then((serverRows) => {
            setUserFiles((prev) =>
              filterOutDeletedUserFileDocs(
                mergeServerAndPendingUserFiles(serverRows, prev),
                deletedUserFileDocIdsRef.current,
              ),
            )
          })
          .catch((err) => {
            console.warn('[fetchUserFilesForCurrentUser]', err)
          })
        try {
          await registerUploadedCloudFile({
            firestoreDocId: docId,
            fileName,
            fileUrl: downloadURL,
            storagePath,
            sizeBytes: typeof file.size === 'number' ? file.size : undefined,
          })
        } catch (regErr) {
          console.warn('[registerUploadedCloudFile]', regErr)
        }
      } catch (e) {
        const code = /** @type {{ code?: string }} */ (e)?.code ?? ''
        const msg =
          code === 'permission-denied'
            ? 'Firestore blocked saving file info. Deploy firestore.rules (user_files) in Firebase Console and ensure you are signed in.'
            : code
              ? `${e?.message ?? 'Firestore error'} (${code})`
              : e?.message ?? 'Failed to save file metadata to Firestore.'
        console.error('[saveUserFileRecord]', e)
        throw new Error(msg)
      }
      try {
        await markUserNotNew()
      } catch (e) {
        console.warn('[markUserNotNew]', e)
      }
      onProgress?.(100)
      return { downloadURL, storagePath, fileName }
    },
    [uid, markUserNotNew, registerUploadedCloudFile],
  )

  const refreshUserFiles = useCallback(async () => {
    try {
      const rows = await fetchUserFilesForCurrentUser()
      setUserFiles((prev) =>
        filterOutDeletedUserFileDocs(
          mergeServerAndPendingUserFiles(rows, prev),
          deletedUserFileDocIdsRef.current,
        ),
      )
      setError(null)
    } catch (e) {
      console.error('[refreshUserFiles]', e)
      setError(e?.message ?? 'Could not refresh file list.')
    }
  }, [])

  /** Save OCR-derived machine index on `user_files` and mirror onto `userData.files` when present. */
  const persistUserFileMachineIndex = useCallback(
    async (firestoreDocId, machineIndex) => {
      if (!uid) throw new Error('Not signed in.')
      const safe = sanitizeForFirestoreDocument(machineIndex)
      await updateUserFileMachineIndex(firestoreDocId, safe)
      try {
        await mergeCloudFileMachineIndexIntoUserData(uid, firestoreDocId, safe)
      } catch (e) {
        console.warn('[mergeCloudFileMachineIndexIntoUserData]', e)
      }
    },
    [uid],
  )

  /** Persist edited OCR/plain text from Dashboard (updates metrics + mirrors userData). */
  const saveUserFileMachineIndexText = useCallback(
    async (firestoreDocId, newText) => {
      if (!uid) throw new Error('Not signed in.')
      const safe = await patchUserFileMachineIndexText(firestoreDocId, newText)
      try {
        await mergeCloudFileMachineIndexIntoUserData(uid, firestoreDocId, safe)
      } catch (e) {
        console.warn('[mergeCloudFileMachineIndexIntoUserData]', e)
      }
    },
    [uid],
  )

  /**
   * Primary delete (Library): remove Storage object, Firestore `user_files`, and workspace mirror.
   * Also clears any Dashboard “hide” entry for this doc id.
   * @param {{ docId: string; storagePath?: string }} p
   */
  const deleteCloudFilePermanently = useCallback(
    async ({ docId, storagePath }) => {
      if (!uid) throw new Error('Not signed in.')
      removeHiddenCloudDocId(uid, docId)
      if (storagePath) {
        try {
          await deleteStorageObject(storagePath)
        } catch (e) {
          console.warn('[deleteStorageObject]', e)
        }
      }
      await deleteUserFileDocument(docId)
      deletedUserFileDocIdsRef.current.add(docId)
      setTimeout(() => {
        deletedUserFileDocIdsRef.current.delete(docId)
      }, 5 * 60_000)
      try {
        await deleteWorkspaceFile(`cloud-${docId}`)
      } catch (e) {
        console.warn('[deleteWorkspaceFile]', e)
      }
      setUserFiles((prev) => prev.filter((r) => r.id !== docId))
    },
    [uid, deleteWorkspaceFile],
  )

  const value = useMemo(
    () => ({
      userFiles,
      userFilesLoading: loading,
      userFilesError: error,
      uploadFileToFirebase,
      refreshUserFiles,
      deleteCloudFilePermanently,
      persistUserFileMachineIndex,
      saveUserFileMachineIndexText,
    }),
    [
      userFiles,
      loading,
      error,
      uploadFileToFirebase,
      refreshUserFiles,
      deleteCloudFilePermanently,
      persistUserFileMachineIndex,
      saveUserFileMachineIndexText,
    ],
  )

  return <UserFilesContext.Provider value={value}>{children}</UserFilesContext.Provider>
}

export function useUserFiles() {
  const ctx = useContext(UserFilesContext)
  if (!ctx) throw new Error('useUserFiles must be used within UserFilesProvider')
  return ctx
}
