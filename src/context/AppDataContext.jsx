import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useAuth } from './AuthContext'
import { subscribeUserData, patchUserData } from '../lib/firestore/userData'

const AppDataContext = createContext(null)

function inferDocType(name) {
  const lower = name.toLowerCase()
  if (lower.includes('inv') || lower.includes('invoice')) return 'invoice'
  if (lower.includes('contract') || lower.includes('agreement')) return 'contract'
  if (lower.includes('receipt')) return 'receipt'
  return 'other'
}

function extFromName(filename) {
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : 'bin'
}

/**
 * Firestore can deliver a snapshot before the latest `files` patch lands, briefly showing an empty list.
 * Keep cloud rows we already have locally until the server copy includes them.
 * @param {unknown[]} fromServer
 * @param {unknown[]} previousLocal
 */
/**
 * Re-merge workspace `files` from Firestore with local-only cloud mirror rows.
 * Only rows still awaiting their first server echo (`_awaitingServerEcho`) may be re-appended;
 * otherwise a deleted cloud row (gone from server but still in React state for one frame)
 * would incorrectly come back as "pending".
 */
function mergePendingCloudFiles(fromServer, previousLocal) {
  const server = Array.isArray(fromServer) ? fromServer : []
  const prev = Array.isArray(previousLocal) ? previousLocal : []
  if (prev.length === 0) return server
  const serverIds = new Set(server.map((f) => f && f.id).filter(Boolean))
  const pending = prev.filter(
    (f) =>
      f &&
      f.fromCloud &&
      f.storageDocId &&
      f._awaitingServerEcho === true &&
      typeof f.id === 'string' &&
      !serverIds.has(f.id),
  )
  if (pending.length === 0) return server
  const byId = new Map()
  for (const row of server) {
    if (row && row.id) byId.set(row.id, row)
  }
  for (const row of pending) {
    if (row && row.id && !byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()]
}

/** Strip client-only fields before writing `userData.files` to Firestore. */
function sanitizeFilesForPersist(files) {
  return files.map((f) => {
    if (!f || typeof f !== 'object') return f
    const { _awaitingServerEcho, ...rest } = f
    return rest
  })
}

export function AppDataProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const uid = user?.id ?? null

  const [files, setFilesState] = useState([])
  const [folders, setFoldersState] = useState([])
  const [queue, setQueueState] = useState([])
  const [isNewUser, setIsNewUser] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    if (!isAuthenticated || !uid) {
      setFilesState([])
      setFoldersState([])
      setQueueState([])
      setIsNewUser(true)
      setDataLoading(false)
      setDataError(null)
      return
    }

    setDataLoading(true)
    setDataError(null)
    const unsub = subscribeUserData(
      uid,
      async (data) => {
        const nextFiles = data.files ?? []
        const nextFolders = data.folders ?? []
        const nextQueue = data.queue ?? []
        const nu = data.isNewUser !== false

        setFilesState((prev) => mergePendingCloudFiles(nextFiles, prev))
        setFoldersState(nextFolders)
        setQueueState(nextQueue)
        setIsNewUser(nu)
        setDataLoading(false)
        setDataError(null)
      },
      (err) => {
        console.error('[Firestore userData]', err)
        setDataError(
          err?.message ??
            'Could not load your workspace. Deploy Firestore rules and ensure the database exists.',
        )
        setDataLoading(false)
      },
    )
    return () => unsub()
  }, [isAuthenticated, uid])

  const markUserNotNew = useCallback(async () => {
    if (!uid) return
    setIsNewUser(false)
    await patchUserData(uid, { isNewUser: false })
  }, [uid])

  const persistAllFiles = useCallback(
    async (next) => {
      setFilesState(next)
      if (!uid) return
      await patchUserData(uid, { files: sanitizeFilesForPersist(next) })
    },
    [uid],
  )

  const persistAllFolders = useCallback(
    async (next) => {
      setFoldersState(next)
      if (!uid) return
      await patchUserData(uid, { folders: next })
    },
    [uid],
  )

  const persistAllQueue = useCallback(
    async (next) => {
      setQueueState(next)
      if (!uid) return
      await patchUserData(uid, { queue: next })
    },
    [uid],
  )

  const addFolder = useCallback(
    async (name) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const id = crypto.randomUUID()
      const folder = { id, name: trimmed, createdAt: new Date().toISOString() }
      await persistAllFolders([...folders, folder])
      return folder
    },
    [folders, persistAllFolders],
  )

  const deleteFolder = useCallback(
    async (folderId) => {
      if (!folderId) return
      const nextFolders = folders.filter((f) => f && f.id !== folderId)
      const nextFiles = files.map((f) =>
        f && f.folderId === folderId ? { ...f, folderId: null } : f,
      )
      await persistAllFolders(nextFolders)
      await persistAllFiles(nextFiles)
    },
    [folders, files, persistAllFolders, persistAllFiles],
  )

  const addUploadedFiles = useCallback(
    async (fileList) => {
      const arr = Array.from(fileList)
      if (arr.length === 0) return
      const now = new Date().toISOString()
      const newDocs = arr.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name.replace(/\.[^/.]+$/, ''),
        ext: extFromName(f.name),
        mime: f.type || 'application/octet-stream',
        size: f.size,
        folderId: null,
        type: inferDocType(f.name),
        confidence: Math.round(85 + Math.random() * 14),
        createdAt: now,
      }))
      await persistAllFiles([...files, ...newDocs])
      await markUserNotNew()
    },
    [files, persistAllFiles, markUserNotNew],
  )

  const addQueueItems = useCallback(
    async (fileList) => {
      const arr = Array.from(fileList)
      if (arr.length === 0) return
      const steps = ['OCR PROCESSING', 'AI CLASSIFICATION', 'METADATA EXTRACTION']
      const newItems = arr.map((f, i) => ({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        progress: i === 0 ? 45 : i === 1 ? 30 : 10,
        step: steps[i % steps.length],
        status: /** @type {'active' | 'pending'} */ (i === arr.length - 1 ? 'pending' : 'active'),
      }))
      await persistAllQueue([...queue, ...newItems])
    },
    [queue, persistAllQueue],
  )

  const updateQueueItem = useCallback(
    async (id, patch) => {
      const next = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      await persistAllQueue(next)
    },
    [queue, persistAllQueue],
  )

  const removeQueueItem = useCallback(
    async (id) => {
      await persistAllQueue(queue.filter((q) => q.id !== id))
    },
    [queue, persistAllQueue],
  )

  const moveFileToFolder = useCallback(
    async (fileId, folderId) => {
      const next = files.map((f) =>
        f.id === fileId ? { ...f, folderId: folderId || null } : f,
      )
      await persistAllFiles(next)
    },
    [files, persistAllFiles],
  )

  const deleteFile = useCallback(
    async (id) => {
      if (!uid) return
      let next = []
      setFilesState((prev) => {
        next = prev.filter((f) => f.id !== id)
        return next
      })
      await patchUserData(uid, { files: sanitizeFilesForPersist(next) })
    },
    [uid],
  )

  /** Persist a Library row in `userData.files` after a cloud upload (backup if `user_files` listener lags). */
  const registerUploadedCloudFile = useCallback(
    async ({ firestoreDocId, fileName, fileUrl, storagePath, sizeBytes }) => {
      if (!uid) return
      const id = `cloud-${firestoreDocId}`
      if (files.some((f) => f.id === id)) return
      const fullName = fileName ?? 'file'
      const hasDot = fullName.includes('.')
      const name = hasDot ? fullName.slice(0, fullName.lastIndexOf('.')) : fullName
      const ext = hasDot ? fullName.slice(fullName.lastIndexOf('.') + 1) : 'bin'
      const entry = {
        id,
        name,
        ext,
        mime: 'application/octet-stream',
        size: typeof sizeBytes === 'number' ? sizeBytes : 0,
        folderId: null,
        type: inferDocType(fullName),
        confidence: 0,
        createdAt: new Date().toISOString(),
        fromCloud: true,
        fileUrl,
        storagePath,
        storageDocId: firestoreDocId,
        /** Client-only: used by merge so deleted rows are not resurrected from stale state. */
        _awaitingServerEcho: true,
      }
      await persistAllFiles([...files, entry])
    },
    [uid, files, persistAllFiles],
  )

  const stats = useMemo(() => {
    const totalBytes = files.reduce((s, f) => s + f.size, 0)
    const avgConf =
      files.length === 0
        ? 0
        : files.reduce((s, f) => s + f.confidence, 0) / files.length
    return {
      totalBytes,
      avgConfidence: Math.round(avgConf * 10) / 10,
      fileCount: files.length,
    }
  }, [files])

  const value = useMemo(
    () => ({
      files,
      folders,
      queue,
      stats,
      isNewUser,
      dataLoading,
      dataError,
      addFolder,
      deleteFolder,
      addUploadedFiles,
      addQueueItems,
      updateQueueItem,
      removeQueueItem,
      moveFileToFolder,
      deleteFile,
      markUserNotNew,
      registerUploadedCloudFile,
    }),
    [
      files,
      folders,
      queue,
      stats,
      isNewUser,
      dataLoading,
      dataError,
      addFolder,
      deleteFolder,
      addUploadedFiles,
      addQueueItems,
      updateQueueItem,
      removeQueueItem,
      moveFileToFolder,
      deleteFile,
      markUserNotNew,
      registerUploadedCloudFile,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
