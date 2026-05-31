import { useMemo, useState } from 'react'
import {
  Eye,
  Pencil,
  Trash2,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  RefreshCw,
  ScanLine,
  Loader2,
} from 'lucide-react'
import { useAppData } from '../../context/AppDataContext'
import { useUserFiles } from '../../context/UserFilesContext'
import { auth } from '../../lib/firebase'
import { downloadUploadedFile } from '../../lib/storage/downloadUploadedFile'
import { buildMachineIndexFromOcr } from '../../lib/ocr/buildMachineIndexFromOcr'
import {
  fileNameSuggestsPdf,
  fileNameSupportsClientOcr,
  rasterizePdfFirstPageToPngBlob,
  runOcrOnCloudFile,
} from '../../lib/ocr/tesseractOcr'
import {
  coerceStorageBlobForNativePreview,
  normalizeStoragePath,
  resolveUserFileBlob,
} from '../../lib/storage/resolveUserFileBlob'
import { classifyDocumentFromOcrText } from '../../lib/classify/classifyDocument'
import { moveUserFileToCategoryFolder } from '../../lib/storage/moveUserFileToCategoryFolder'
import { updateUserFileStorageLocationAndClassification } from '../../lib/firestore/userFiles'

const tabs = [
  { id: 'all', label: 'All Files' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'contract', label: 'Contracts' },
  { id: 'receipt', label: 'Receipts' },
  { id: 'other', label: 'Other' },
]

const typeStyles = {
  invoice: 'bg-emerald-100 text-emerald-800',
  contract: 'bg-blue-100 text-blue-800',
  receipt: 'bg-amber-100 text-amber-800',
  other: 'bg-slate-100 text-slate-700',
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function formatFirestoreTimestamp(ts) {
  try {
    if (ts && typeof ts.toDate === 'function') {
      return ts.toDate().toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    if (ts && typeof ts.seconds === 'number') {
      return new Date(ts.seconds * 1000).toLocaleString()
    }
    return '—'
  } catch {
    return '—'
  }
}

/** Let React paint the preview frame before heavy OCR blocks the main thread. */
function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(undefined)
      })
    })
  })
}

function inferDocTypeFromName(name) {
  const lower = (name ?? '').toLowerCase()
  if (lower.includes('inv') || lower.includes('invoice')) return 'invoice'
  if (lower.includes('contract') || lower.includes('agreement')) return 'contract'
  if (lower.includes('receipt')) return 'receipt'
  return 'other'
}

function inferDocTypeFromCloudClassification(row) {
  const raw =
    (row && typeof row.category === 'string' && row.category) ||
    (row &&
      row.classification &&
      typeof row.classification === 'object' &&
      typeof row.classification.category === 'string' &&
      row.classification.category) ||
    ''
  const c = String(raw).trim().toLowerCase()
  if (c === 'invoice') return 'invoice'
  if (c === 'receipt') return 'receipt'
  if (c === 'contract') return 'contract'
  // Keep existing tab set stable; map new categories to "other" until tabs are expanded.
  if (c === 'id card' || c === 'id-card' || c === 'report' || c === 'unknown') return 'other'
  return ''
}

function firestoreTimestampToIso(ts) {
  try {
    if (ts && typeof ts.toDate === 'function') return ts.toDate().toISOString()
    if (ts && typeof ts.seconds === 'number') return new Date(ts.seconds * 1000).toISOString()
  } catch {
    /* ignore */
  }
  return new Date().toISOString()
}

/** Map Firestore `user_files` rows into the same shape as workspace `files` for one combined Library list. */
function cloudRowsToLibraryFiles(userFiles) {
  return userFiles.map((r) => {
    const fullName = r.fileName ?? 'file'
    const hasDot = fullName.includes('.')
    const name = hasDot ? fullName.slice(0, fullName.lastIndexOf('.')) : fullName
    const ext = hasDot ? fullName.slice(fullName.lastIndexOf('.') + 1) : 'bin'
    return {
      id: `cloud-${r.id}`,
      name,
      ext,
      mime: 'application/octet-stream',
      size: typeof r.sizeBytes === 'number' && !Number.isNaN(r.sizeBytes) ? r.sizeBytes : 0,
      folderId: typeof r.folderId === 'string' && r.folderId ? r.folderId : null,
      type: inferDocTypeFromCloudClassification(r) || inferDocTypeFromName(fullName),
      confidence:
        r &&
        r.classification &&
        typeof r.classification === 'object' &&
        typeof r.classification.confidence === 'number' &&
        !Number.isNaN(r.classification.confidence)
          ? r.classification.confidence
          : 0,
      createdAt: firestoreTimestampToIso(r.timestamp),
      fromCloud: true,
      fileUrl: r.fileUrl,
      storagePath: r.storagePath,
      storageDocId: r.id,
      machineIndexed: Boolean(r.machineIndex),
    }
  })
}

/** Full library UI (workspace + cloud). Rendered below Upload Center on the same page. */
export function LibrarySection() {
  const { files, folders, deleteFile, moveFileToFolder, addFolder, deleteFolder } = useAppData()
  const {
    userFiles,
    userFilesLoading,
    userFilesError,
    refreshUserFiles,
    deleteCloudFilePermanently,
    persistUserFileMachineIndex,
  } = useUserFiles()
  const [tab, setTab] = useState('all')
  const [folderFilter, setFolderFilter] = useState('all')
  const [newFolder, setNewFolder] = useState('')
  const [page, setPage] = useState(1)
  const [downloadBusyId, setDownloadBusyId] = useState(/** @type {string | null} */ (null))
  const [deleteCloudBusyId, setDeleteCloudBusyId] = useState(/** @type {string | null} */ (null))
  const [ocrBusyId, setOcrBusyId] = useState(/** @type {string | null} */ (null))
  const [ocrProgress, setOcrProgress] = useState(/** @type {number | null} */ (null))
  const [ocrModal, setOcrModal] = useState(
    /** @type {null | { title: string; text: string; confidence: number; indexSaved?: boolean; indexSaveError?: string | null; classifiedAs?: string; classifiedConfidence?: number; classifyError?: string | null }} */ (null),
  )
  const [classifyFolderPrompt, setClassifyFolderPrompt] = useState(
    /** @type {null | { storageDocId: string; fileName: string; storagePath: string; fileUrl: string; category: string; classification: { category: string; confidence: number; scoresByLabel?: Record<string, number> } }} */ (null),
  )
  const [unknownFolderPrompt, setUnknownFolderPrompt] = useState(
    /** @type {null | { storageDocId: string; fileName: string; storagePath: string; fileUrl: string; classification: { category: string; confidence: number; scoresByLabel?: Record<string, number> } }} */ (null),
  )
  const [unknownFolderChoice, setUnknownFolderChoice] = useState('')
  const [unknownNewFolderName, setUnknownNewFolderName] = useState('')
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false)

  const DEFAULT_FOLDER_NAMES = ['Invoices', 'Contracts', 'Receipts', 'Other']
  /** Full-screen scan experience while OCR runs (preview + animated scanner). */
  const [ocrScan, setOcrScan] = useState(
    /** @type {null | { phase: 'loading' | 'preview'; title: string; previewUrl?: string; kind?: 'image' }} */ (null),
  )
  const perPage = 10

  const runDownload = async ({
    busyKey,
    storagePath,
    fileUrl,
    fileName,
  }) => {
    setDownloadBusyId(busyKey)
    try {
      await downloadUploadedFile({ storagePath, fileUrl, fileName })
    } catch (e) {
      window.alert(e?.message ?? 'Download failed')
    } finally {
      setDownloadBusyId(null)
    }
  }

  const runOcr = async ({
    busyKey,
    storagePath,
    fileUrl,
    fileName,
  }) => {
    if (!fileNameSupportsClientOcr(fileName)) {
      window.alert(
        'OCR (Tesseract.js) supports raster images (PNG, JPEG, WebP, GIF, BMP, TIFF) and PDF (first page only). This filename does not look like a supported type.',
      )
      return
    }
    setOcrBusyId(busyKey)
    setOcrProgress(0)
    setOcrScan({ phase: 'loading', title: fileName })
    let previewUrl = ''
    try {
      const path = normalizeStoragePath(storagePath)
      const rawBlob = await resolveUserFileBlob(path || '', fileUrl)
      if (!rawBlob || rawBlob.size === 0) {
        throw new Error('The file from Storage is empty or could not be read.')
      }
      const blob = await coerceStorageBlobForNativePreview(rawBlob, fileName)
      const isPdf =
        fileNameSuggestsPdf(fileName) || (blob.type || '').toLowerCase().includes('pdf')
      /** `<object>` + blob PDF is often blank in Chrome; rasterize once and show `<img>`. */
      const previewBlob = isPdf ? await rasterizePdfFirstPageToPngBlob(blob) : blob
      previewUrl = URL.createObjectURL(previewBlob)
      setOcrScan({ phase: 'preview', title: fileName, previewUrl, kind: 'image' })

      await yieldToPaint()

      const { text, confidence } = await runOcrOnCloudFile({
        storagePath,
        fileUrl,
        fileName,
        fileBlob: blob,
        ...(isPdf ? { ocrImageBlob: previewBlob } : {}),
        onProgress: (n) => setOcrProgress(n),
      })
      const trimmed = (text || '').trim()
      const machineIndex = buildMachineIndexFromOcr({
        fileName,
        text: trimmed || text || '',
        confidence,
      })
      const storageDocId = busyKey.startsWith('cloud-') ? busyKey.slice('cloud-'.length) : busyKey
      let indexSaved = false
      let indexSaveError = /** @type {string | null} */ (null)
      let classifiedAs = ''
      let classifiedConfidence = 0
      let classifyError = /** @type {string | null} */ (null)
      try {
        await persistUserFileMachineIndex(storageDocId, machineIndex)
        indexSaved = true
      } catch (persistErr) {
        console.warn('[persistUserFileMachineIndex]', persistErr)
        indexSaveError = persistErr?.message ?? 'Could not save machine index to Firestore.'
      }

      // Auto-classify + move the Storage object into `users/{uid}/{category}/...`.
      // Best-effort: if classifier isn't configured or move fails, OCR indexing still succeeds.
      try {
        const cls = await classifyDocumentFromOcrText({
          text: trimmed || text || '',
          fileName,
          labels: ['invoice', 'receipt', 'id card', 'report'],
          threshold: 0.6,
        })
        classifiedAs = cls.category
        classifiedConfidence = cls.confidence
        const uid = auth?.currentUser?.uid
        if (uid) {
          // Save classification even if the Storage move fails (so UI can categorize immediately).
          await updateUserFileStorageLocationAndClassification(storageDocId, {
            storagePath,
            fileUrl,
            category: cls.category,
            classification: {
              category: cls.category,
              confidence: cls.confidence,
              scoresByLabel: cls.scores_by_label,
            },
          })

          // If the classifier is unsure, let the user pick a folder (or create one) in a dialog.
          if (String(cls.category).trim().toLowerCase() === 'unknown') {
            setUnknownFolderChoice('')
            setUnknownNewFolderName('')
            setUnknownFolderPrompt({
              storageDocId,
              fileName,
              storagePath,
              fileUrl,
              classification: {
                category: cls.category,
                confidence: cls.confidence,
                scoresByLabel: cls.scores_by_label,
              },
            })
            throw new Error('Awaiting unknown folder choice')
          }

          const normCategory = String(cls.category || '').trim()
          /** Ensure the category exists as an app "folder" (Firestore userData.folders). */
          let folderId = null
          if (normCategory && normCategory.toLowerCase() !== 'unknown') {
            const existing = (folders || []).find(
              (f) =>
                f &&
                typeof f.name === 'string' &&
                f.name.trim().toLowerCase() === normCategory.toLowerCase(),
            )
            if (existing?.id) {
              folderId = existing.id
            } else {
              const created = await addFolder(normCategory)
              folderId = created?.id ?? null
            }
          }

          const { newStoragePath, newFileUrl } = await moveUserFileToCategoryFolder({
            uid,
            storagePath,
            fileUrl,
            fileName,
            category: cls.category,
          })
          await updateUserFileStorageLocationAndClassification(storageDocId, {
            storagePath: newStoragePath,
            fileUrl: newFileUrl,
            category: cls.category,
            ...(folderId ? { folderId } : {}),
            classification: {
              category: cls.category,
              confidence: cls.confidence,
              scoresByLabel: cls.scores_by_label,
            },
          })
        }
      } catch (classifyErr) {
        // Special case: we intentionally pause when prompting for folder choice.
        if (
          String(classifyErr?.message ?? '').includes('Awaiting folder choice') ||
          String(classifyErr?.message ?? '').includes('Awaiting unknown folder choice')
        ) {
          // leave classifyError empty so the modal doesn't show a failure
        } else if (classifiedAs && classifiedAs !== 'unknown') {
          // Classification succeeded; Storage move or folder update failed — don't hide the result.
          console.warn('[auto-classify/move]', classifyErr)
          classifyError = `Classified as "${classifiedAs}", but could not move file: ${classifyErr?.message ?? String(classifyErr)}`
        } else {
          console.warn('[auto-classify/move]', classifyErr)
          classifyError = classifyErr?.message ?? String(classifyErr)
        }
      }
      setOcrModal({
        title: fileName,
        text: trimmed || '(No text detected)',
        confidence,
        indexSaved,
        indexSaveError,
        classifiedAs,
        classifiedConfidence,
        classifyError,
      })
    } catch (e) {
      window.alert(e?.message ?? 'OCR failed')
    } finally {
      setOcrScan(null)
      setOcrBusyId(null)
      setOcrProgress(null)
      if (previewUrl) {
        const revoke = previewUrl
        requestAnimationFrame(() => {
          URL.revokeObjectURL(revoke)
        })
      }
    }
  }

  const allFiles = useMemo(() => {
    const cloud = cloudRowsToLibraryFiles(userFiles)
    const liveCloudDocIds = new Set(userFiles.map((r) => r.id))
    /** Drop stale `userData.files` mirrors whose `user_files` row was deleted (Firestore is source of truth). */
    const workspaceSynced = files.filter((f) => {
      if (!String(f.id).startsWith('cloud-')) return true
      const docId = String(f.id).slice('cloud-'.length)
      return liveCloudDocIds.has(docId)
    })
    const byId = new Map()
    for (const f of workspaceSynced) byId.set(f.id, f)
    for (const c of cloud) {
      const prev = byId.get(c.id)
      if (prev) {
        const indexed =
          Boolean(c.machineIndexed) ||
          Boolean(prev.machineIndexed) ||
          Boolean(c.machineIndex) ||
          Boolean(prev.machineIndex)
        byId.set(c.id, { ...prev, ...c, machineIndexed: indexed })
      } else {
        byId.set(c.id, c)
      }
    }
    return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [userFiles, files])

  const filtered = useMemo(() => {
    return allFiles.filter((f) => {
      if (tab !== 'all' && f.type !== tab) return false
      if (folderFilter === 'all') return true
      if (folderFilter === 'none') return !f.folderId
      return f.folderId === folderFilter
    })
  }, [allFiles, tab, folderFilter])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const slice = filtered.slice((page - 1) * perPage, page * perPage)

  function exportCsv() {
    const header = ['filename', 'type', 'date', 'confidence', 'folder']
    const rows = filtered.map((f) => {
      const folderName = folders.find((x) => x.id === f.folderId)?.name ?? ''
      return [
        `${f.name}.${f.ext}`,
        f.type,
        f.createdAt,
        String(f.confidence),
        f.fromCloud ? 'Cloud' : folderName,
      ]
    })
    const csv = [header.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'docmind-library.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 sm:text-xl">Repository</h3>
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">
            Workspace files (Firestore <code className="rounded bg-slate-100 px-1 text-xs">userData</code>) and
            cloud uploads (<code className="rounded bg-slate-100 px-1 text-xs">user_files</code> + Storage) appear
            together below. Cloud files are stored in <strong>their original format</strong>. <strong>OCR</strong> runs{' '}
            <strong>Tesseract.js</strong> in the browser on raster images (PNG, JPEG, etc.) and on{' '}
            <strong>PDF first pages</strong> (rasterized with pdf.js). <strong>Delete</strong> on
            a cloud row removes the file everywhere (Storage + Dashboard
            overview).
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void refreshUserFiles()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:w-auto"
            title="Reload file list from Firestore"
          >
            <RefreshCw className="h-4 w-4" />
            Sync library
          </button>
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:w-auto"
          >
            <Filter className="h-4 w-4" />
            Advanced Filters
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Your cloud files</h3>
        <p className="mt-1 text-sm text-slate-600">
          Stored in Firebase Storage; metadata in <code className="rounded bg-white px-1 text-xs">user_files</code>.
          Download from any signed-in device.
        </p>
        {userFilesLoading && (
          <p className="mt-4 text-sm text-slate-500">Loading your files…</p>
        )}
        {userFilesError && (
          <p className="mt-4 text-sm text-red-600">{userFilesError}</p>
        )}
        {!userFilesLoading && !userFilesError && userFiles.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">
            No uploads yet. Scroll up to upload files or use the upload area above.
          </p>
        )}
        {userFiles.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white [-webkit-overflow-scrolling:touch]">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Filename</th>
                  <th className="px-4 py-3">Uploaded</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {userFiles.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {row.fileName ?? 'file'}
                        {row.machineIndex ? (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                            Indexed
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatFirestoreTimestamp(row.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          disabled={downloadBusyId === row.id}
                          onClick={() =>
                            runDownload({
                              busyKey: row.id,
                              storagePath: row.storagePath,
                              fileUrl: row.fileUrl,
                              fileName: row.fileName ?? 'file',
                            })
                          }
                          className="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {downloadBusyId === row.id ? '…' : 'Download'}
                        </button>
                        <button
                          type="button"
                          disabled={
                            ocrBusyId === row.id || !fileNameSupportsClientOcr(row.fileName ?? '')
                          }
                          title={
                            fileNameSupportsClientOcr(row.fileName ?? '')
                              ? 'Run Tesseract OCR (browser; PDF = first page)'
                              : 'OCR: PNG, JPEG, WebP, GIF, BMP, TIFF, or PDF'
                          }
                          onClick={() =>
                            runOcr({
                              busyKey: row.id,
                              storagePath: row.storagePath,
                              fileUrl: row.fileUrl,
                              fileName: row.fileName ?? 'file',
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ScanLine className="h-3.5 w-3.5" />
                          {ocrBusyId === row.id
                            ? ocrProgress != null
                              ? `${Math.round(ocrProgress * 100)}%`
                              : '…'
                            : 'OCR'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id)
              setPage(1)
            }}
            className={[
              'rounded-full px-4 py-2 text-sm font-medium transition',
              tab === t.id
                ? 'bg-white text-indigo-700 shadow-md ring-1 ring-slate-200'
                : 'text-slate-600 hover:bg-white/80',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <FolderOpen className="h-4 w-4 text-indigo-600" />
          <span className="font-medium">Folders</span>
        </div>
        <select
          value={folderFilter}
          onChange={(e) => {
            setFolderFilter(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
        >
          <option value="all">All folders</option>
          <option value="none">Unsorted</option>
          {folders.map((fo) => (
            <option key={fo.id} value={fo.id}>
              {fo.name}
            </option>
          ))}
        </select>
        <form
          className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          onSubmit={(e) => {
            e.preventDefault()
            addFolder(newFolder)
            setNewFolder('')
          }}
        >
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="New folder name"
            className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm sm:min-w-[160px] sm:w-auto"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add folder
          </button>
          <button
            type="button"
            onClick={() => setManageFoldersOpen(true)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Manage
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm [-webkit-overflow-scrolling:touch]">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Filename</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Folder</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Confidence</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  {allFiles.length > 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      <p>No documents match the current type or folder filters.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setTab('all')
                          setFolderFilter('all')
                          setPage(1)
                        }}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                      >
                        Show all files
                      </button>
                      <p className="max-w-md text-xs text-slate-400">
                        Tip: PDFs and images are often under <strong>Other</strong> unless the filename looks like an invoice or receipt.
                      </p>
                    </div>
                  ) : userFilesLoading ? (
                    'Loading your library…'
                  ) : userFilesError ? (
                    <span className="text-red-600">{userFilesError}</span>
                  ) : (
                    <>
                      No documents yet.{' '}
                      <a href="#" className="font-medium text-indigo-600 hover:underline" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                        Go to upload area
                      </a>{' '}
                      above to add them.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              slice.map((f) => {
                const isCloud = Boolean(f.fromCloud)
                return (
                  <tr key={f.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {f.name}.{f.ext}
                        {isCloud && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0 text-[10px] font-semibold uppercase text-emerald-800">
                            Cloud
                          </span>
                        )}
                        {isCloud && f.machineIndexed ? (
                          <span className="rounded-full bg-violet-100 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                            Indexed
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${typeStyles[f.type] ?? typeStyles.other}`}
                      >
                        {f.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {isCloud ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <select
                          value={f.folderId ?? ''}
                          onChange={(e) => moveFileToFolder(f.id, e.target.value || null)}
                          className="max-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="">Unsorted</option>
                          {folders.map((fo) => (
                            <option key={fo.id} value={fo.id}>
                              {fo.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(f.createdAt)}</td>
                    <td className="px-4 py-3">
                      {isCloud ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-800">{f.confidence}%</span>
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${f.confidence}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {isCloud && (f.fileUrl || f.storagePath) ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              disabled={downloadBusyId === f.id}
                              onClick={() =>
                                runDownload({
                                  busyKey: f.id,
                                  storagePath: f.storagePath,
                                  fileUrl: f.fileUrl,
                                  fileName: `${f.name}.${f.ext}`,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {downloadBusyId === f.id ? '…' : 'Download'}
                            </button>
                            <button
                              type="button"
                              disabled={
                                ocrBusyId === f.id || !fileNameSupportsClientOcr(`${f.name}.${f.ext}`)
                              }
                              title={
                                fileNameSupportsClientOcr(`${f.name}.${f.ext}`)
                                  ? 'Tesseract OCR (browser; PDF = first page)'
                                  : 'OCR: PNG, JPEG, WebP, GIF, BMP, TIFF, or PDF'
                              }
                              onClick={() =>
                                runOcr({
                                  busyKey: f.id,
                                  storagePath: f.storagePath,
                                  fileUrl: f.fileUrl,
                                  fileName: `${f.name}.${f.ext}`,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ScanLine className="h-3.5 w-3.5" />
                              {ocrBusyId === f.id
                                ? ocrProgress != null
                                  ? `${Math.round(ocrProgress * 100)}%`
                                  : '…'
                                : 'OCR'}
                            </button>
                            <button
                              type="button"
                              disabled={deleteCloudBusyId === f.id}
                              title="Permanently delete from cloud (Library + Dashboard)"
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    'Permanently delete this file from Firebase Storage and your library? This cannot be undone.',
                                  )
                                ) {
                                  return
                                }
                                const docId = f.id.startsWith('cloud-')
                                  ? f.id.slice('cloud-'.length)
                                  : f.id
                                setDeleteCloudBusyId(f.id)
                                try {
                                  await deleteCloudFilePermanently({
                                    docId,
                                    storagePath: f.storagePath,
                                  })
                                } catch (e) {
                                  window.alert(e?.message ?? 'Delete failed')
                                } finally {
                                  setDeleteCloudBusyId(null)
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {deleteCloudBusyId === f.id ? '…' : 'Delete'}
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                              aria-label="View"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                              aria-label="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteFile(f.id)}
                              className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>
            Showing {total === 0 ? 0 : (page - 1) * perPage + 1} to{' '}
            {Math.min(page * perPage, total)} of {total} documents
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="rounded-lg bg-indigo-600 px-3 py-1 font-medium text-white">{page}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total storage</p>
          <p className="mt-2 text-lg font-bold text-slate-900">
            {(allFiles.reduce((s, f) => s + f.size, 0) / (1024 * 1024 * 1024)).toFixed(2)} GB / 50 GB
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            AI confidence avg.
          </p>
          <p className="mt-2 text-lg font-bold text-slate-900">
            {files.length
              ? (files.reduce((s, f) => s + f.confidence, 0) / files.length).toFixed(1)
              : '0'}
            %
          </p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white shadow-sm">
          <p className="text-[11px] font-semibold uppercase opacity-90">Current plan</p>
          <p className="mt-2 text-xl font-bold">Enterprise Plus</p>
        </div>
      </div>

      {ocrScan && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label="Document scanning"
        >
          <div className="w-full max-w-lg rounded-2xl border border-indigo-400/25 bg-gradient-to-b from-slate-900/95 to-slate-950 p-6 shadow-2xl shadow-indigo-950/50 ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300/90">
                  Live scan
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-white">{ocrScan.title}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {ocrScan.phase === 'loading'
                    ? 'Loading your document…'
                    : 'Tesseract is reading the page. Watch the beam sweep the document.'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {ocrProgress != null ? (
                  <span className="rounded-full bg-indigo-500/20 px-2.5 py-1 font-mono text-xs font-semibold text-indigo-200">
                    {Math.round(ocrProgress * 100)}%
                  </span>
                ) : null}
                <ScanLine className="h-8 w-8 text-indigo-400" aria-hidden />
              </div>
            </div>

            <div className="relative mx-auto mt-5 flex aspect-[3/4] max-h-[58vh] w-full items-center justify-center overflow-hidden rounded-xl border border-indigo-500/20 bg-black/50">
              {ocrScan.phase === 'loading' ? (
                <div className="flex flex-col items-center gap-3 px-4 text-center text-slate-400">
                  <Loader2 className="h-10 w-10 animate-spin text-indigo-400" aria-hidden />
                  <span className="text-sm">Preparing preview</span>
                  <span className="max-w-[280px] text-[11px] leading-snug text-slate-500">
                    Fetching from Firebase Storage (up to ~45s). If nothing changes, check DevTools → Network
                    for a stuck request, VPN, or firewall blocking Google.
                  </span>
                </div>
              ) : ocrScan.previewUrl ? (
                <img
                  key={ocrScan.previewUrl}
                  src={ocrScan.previewUrl}
                  alt=""
                  className="relative z-[1] max-h-full max-w-full object-contain"
                />
              ) : null}

              {ocrScan.phase === 'preview' && ocrScan.previewUrl ? (
                <>
                  <div
                    className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,transparent_0%,rgba(99,102,241,0.04)_45%,rgba(129,140,248,0.06)_50%,rgba(99,102,241,0.04)_55%,transparent_100%)] bg-[length:100%_220%] animate-[pulse_3s_ease-in-out_infinite]"
                    aria-hidden
                  />
                  <div className="pointer-events-none absolute inset-0 z-[2] shadow-[inset_0_0_60px_rgba(0,0,0,0.2)]" />
                  <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden rounded-[inherit]">
                    <div
                      className="library-ocr-scan-line absolute left-[-2%] right-[-2%] h-1 rounded-full"
                      aria-hidden
                    />
                  </div>
                </>
              ) : null}
            </div>

            <p className="mt-4 text-center text-xs text-slate-500">
              Processing runs locally in your browser — nothing is sent to our servers for OCR.
            </p>
          </div>
        </div>
      )}

      {ocrModal && (
        <div
          className="fixed inset-0 z-[101] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ocr-result-title"
        >
          <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[88vh] sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 pr-4">
                <h2 id="ocr-result-title" className="text-lg font-semibold text-slate-900">
                  OCR result
                </h2>
                <p className="mt-0.5 truncate text-xs text-slate-500" title={ocrModal.title}>
                  {ocrModal.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOcrModal(null)}
                className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="border-b border-slate-100 px-5 py-2 text-xs text-slate-600">
              <p>
                Tesseract.js (in your browser) · confidence{' '}
                <span className="font-mono font-semibold">{ocrModal.confidence.toFixed(1)}</span>
              </p>
              {ocrModal.indexSaved ? (
                <p className="mt-1.5 font-medium text-emerald-700">
                  Machine-readable index saved to Firestore (
                  <code className="rounded bg-emerald-50 px-1">user_files.machineIndex</code>
                  , and the same object on your workspace cloud row when it exists). Rules or Cloud Functions can
                  match on <code className="rounded bg-slate-100 px-1">text</code>,{' '}
                  <code className="rounded bg-slate-100 px-1">keySpans.firstLines</code>, and{' '}
                  <code className="rounded bg-slate-100 px-1">rulesHint.tokens</code>, then e.g. set a folder field
                  you define.
                </p>
              ) : ocrModal.indexSaveError ? (
                <p className="mt-1.5 text-amber-800">
                  OCR ran, but saving the index failed: {ocrModal.indexSaveError}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-slate-700">Classifier</span>
                {ocrModal.classifyError ? (
                  <span className="text-red-700">
                    Failed: <span className="font-mono">{ocrModal.classifyError}</span>
                  </span>
                ) : ocrModal.classifiedAs ? (
                  <span className="text-indigo-700">
                    classified as <span className="font-mono font-semibold">{ocrModal.classifiedAs}</span>{' '}
                    {typeof ocrModal.classifiedConfidence === 'number' ? (
                      <span className="text-slate-600">
                        (confidence <span className="font-mono">{ocrModal.classifiedConfidence.toFixed(3)}</span>)
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-slate-500">Not run</span>
                )}
              </div>
            </div>
            <pre className="min-h-[120px] flex-1 overflow-auto whitespace-pre-wrap bg-slate-50 px-5 py-4 text-sm text-slate-800">
              {ocrModal.text}
            </pre>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(ocrModal.text).catch(() => {
                    window.alert('Could not copy to clipboard.')
                  })
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Copy text
              </button>
              <button
                type="button"
                onClick={() => setOcrModal(null)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {classifyFolderPrompt && (
        <div
          className="fixed inset-0 z-[102] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="classify-folder-title"
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 id="classify-folder-title" className="text-lg font-semibold text-slate-900">
                Create a new folder?
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                The classifier suggests this document is{' '}
                <span className="font-mono font-semibold text-indigo-700">
                  {classifyFolderPrompt.category}
                </span>
                . You don't have a folder with that name yet.
              </p>
            </div>
            <div className="px-5 py-4 text-sm text-slate-700">
              <p className="truncate">
                File: <span className="font-mono">{classifyFolderPrompt.fileName}</span>
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setClassifyFolderPrompt(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Save in Other
              </button>
              <button
                type="button"
                onClick={async () => {
                  const p = classifyFolderPrompt
                  setClassifyFolderPrompt(null)
                  const uid = auth?.currentUser?.uid
                  if (!p || !uid) return
                  const folder = await addFolder(p.category)
                  const folderId = folder?.id ?? null
                  await updateUserFileStorageLocationAndClassification(p.storageDocId, {
                    storagePath: p.storagePath,
                    fileUrl: p.fileUrl,
                    category: p.category,
                    folderId,
                    classification: p.classification,
                  })
                  const { newStoragePath, newFileUrl } = await moveUserFileToCategoryFolder({
                    uid,
                    storagePath: p.storagePath,
                    fileUrl: p.fileUrl,
                    fileName: p.fileName,
                    category: p.category,
                  })
                  await updateUserFileStorageLocationAndClassification(p.storageDocId, {
                    storagePath: newStoragePath,
                    fileUrl: newFileUrl,
                    category: p.category,
                    folderId,
                    classification: p.classification,
                  })
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Create “{classifyFolderPrompt.category}” and move
              </button>
            </div>
          </div>
        </div>
      )}

      {unknownFolderPrompt && (
        <div
          className="fixed inset-0 z-[103] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unknown-folder-title"
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 id="unknown-folder-title" className="text-lg font-semibold text-slate-900">
                Choose a folder
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                The classifier is not confident enough to auto-file this document. Choose where to put it, or create a
                new folder.
              </p>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm text-slate-700">
              <p className="truncate">
                File: <span className="font-mono">{unknownFolderPrompt.fileName}</span>
              </p>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Existing folders
                </label>
                <select
                  value={unknownFolderChoice}
                  onChange={(e) => setUnknownFolderChoice(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Select a folder —</option>
                  {DEFAULT_FOLDER_NAMES.map((name) => (
                    <option key={name} value={`__default:${name}`}>
                      {name}
                    </option>
                  ))}
                  {(folders || []).length > 0 ? (
                    <option disabled value="__divider">
                      ──────────
                    </option>
                  ) : null}
                  {(folders || []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Or create a new folder
                </label>
                <input
                  value={unknownNewFolderName}
                  onChange={(e) => setUnknownNewFolderName(e.target.value)}
                  placeholder="e.g. ID card"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setUnknownFolderPrompt(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Keep in Other
              </button>
              <button
                type="button"
                onClick={async () => {
                  const p = unknownFolderPrompt
                  setUnknownFolderPrompt(null)
                  const uid = auth?.currentUser?.uid
                  if (!p || !uid) return

                  let folderId = unknownFolderChoice || ''
                  let folderName = ''

                  if (unknownNewFolderName.trim()) {
                    const folder = await addFolder(unknownNewFolderName.trim())
                    folderId = folder?.id ?? ''
                    folderName = folder?.name ?? unknownNewFolderName.trim()
                  } else if (folderId && folderId.startsWith('__default:')) {
                    folderName = folderId.slice('__default:'.length).trim()
                    const existing = (folders || []).find(
                      (f) => f && typeof f.name === 'string' && f.name.trim().toLowerCase() === folderName.toLowerCase(),
                    )
                    if (existing?.id) {
                      folderId = existing.id
                    } else {
                      const created = await addFolder(folderName)
                      folderId = created?.id ?? ''
                      folderName = created?.name ?? folderName
                    }
                  } else if (folderId) {
                    folderName = (folders || []).find((f) => f.id === folderId)?.name ?? ''
                  }

                  if (!folderId || !folderName) {
                    // No selection; do nothing (stays in Other)
                    return
                  }

                  await updateUserFileStorageLocationAndClassification(p.storageDocId, {
                    storagePath: p.storagePath,
                    fileUrl: p.fileUrl,
                    folderId,
                    category: 'unknown',
                    classification: p.classification,
                  })

                  const { newStoragePath, newFileUrl } = await moveUserFileToCategoryFolder({
                    uid,
                    storagePath: p.storagePath,
                    fileUrl: p.fileUrl,
                    fileName: p.fileName,
                    category: folderName,
                  })

                  await updateUserFileStorageLocationAndClassification(p.storageDocId, {
                    storagePath: newStoragePath,
                    fileUrl: newFileUrl,
                    folderId,
                    category: 'unknown',
                    classification: p.classification,
                  })
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Save to selected folder
              </button>
            </div>
          </div>
        </div>
      )}

      {manageFoldersOpen && (
        <div
          className="fixed inset-0 z-[104] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-folders-title"
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 id="manage-folders-title" className="text-lg font-semibold text-slate-900">
                Manage folders
              </h2>
              <button
                type="button"
                onClick={() => setManageFoldersOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="max-h-[60vh] space-y-3 overflow-auto px-5 py-4">
              {(!folders || folders.length === 0) && (
                <p className="text-sm text-slate-600">No custom folders yet.</p>
              )}
              {(folders || []).map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{f.name}</p>
                    <p className="truncate text-xs text-slate-500">id: {f.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = window.confirm(
                        `Delete folder "${f.name}"? Files in this folder will be set to no folder.`,
                      )
                      if (!ok) return

                      // 1) Remove folder from userData + clear workspace file assignments.
                      await deleteFolder(f.id)

                      // 2) Clear cloud file assignments (best-effort, for currently loaded cloud rows).
                      const affected = (userFiles || []).filter(
                        (r) => r && typeof r.folderId === 'string' && r.folderId === f.id,
                      )
                      for (const r of affected) {
                        try {
                          await updateUserFileStorageLocationAndClassification(r.id, {
                            storagePath: r.storagePath,
                            fileUrl: r.fileUrl,
                            folderId: null,
                          })
                        } catch (e) {
                          console.warn('[deleteFolder] clear cloud folderId failed', r.id, e)
                        }
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    title="Delete folder"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
