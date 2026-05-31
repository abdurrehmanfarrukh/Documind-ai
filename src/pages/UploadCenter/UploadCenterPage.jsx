import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Upload,
  ListX,
  Pause,
  X,
  Plus,
  FileText,
  Cloud,
} from 'lucide-react'
import { useUserFiles } from '../../context/UserFilesContext'
import { isFirebaseConfigured, isStorageReady } from '../../lib/firebase'
import { LibrarySection } from '../Library/LibrarySection'

const steps = ['UPLOADING TO CLOUD', 'FINALIZING', 'COMPLETE']
const SESSION_JOBS_KEY = 'docmind_upload_queue_v1'

const OPEN_UPLOAD_PICKER_EVENT = 'docmind-open-upload-picker'

/**
 * @param {Array<{ id?: string; file: File; previewUrl: string | null }>} items
 */
function revokePendingPreviewUrls(items) {
  items.forEach((p) => {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
  })
}

/** @param {number} bytes */
function formatUploadSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function UploadCenterPage() {
  const inputRef = useRef(null)
  const pendingItemsRef = useRef(
    /** @type {Array<{ id: string; file: File; previewUrl: string | null }>} */ ([]),
  )
  const location = useLocation()
  const navigate = useNavigate()
  const { uploadFileToFirebase } = useUserFiles()
  const [dragOver, setDragOver] = useState(false)
  /** Files chosen but not yet uploaded — preview + confirm step */
  const [pendingItems, setPendingItems] = useState(
    /** @type {Array<{ id: string; file: File; previewUrl: string | null }>} */ ([]),
  )
  /** Remount the hidden `<input type="file">` so Cancel / repeat uploads always get a clean picker + `change` events. */
  const [fileInputKey, setFileInputKey] = useState(0)
  /** Synchronous guard — React state can lag one frame; refs avoid “stuck busy” blocking the next picker open. */
  const uploadInFlightRef = useRef(false)
  /** True while a confirmed batch is uploading (UI only). */
  const [uploadBatchBusy, setUploadBatchBusy] = useState(false)
  /** @type {Array<{ id: string; name: string; size: number; progress: number; status: string; step: string; error?: string }>} */
  const [jobs, setJobs] = useState(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_JOBS_KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      /* ignore */
    }
    return []
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_JOBS_KEY, JSON.stringify(jobs))
    } catch {
      /* ignore */
    }
  }, [jobs])

  useEffect(() => {
    pendingItemsRef.current = pendingItems
  }, [pendingItems])

  useEffect(() => {
    return () => revokePendingPreviewUrls(pendingItemsRef.current)
  }, [])

  /** Browsers skip `change` if the user picks the same path again — must clear before each open. */
  const resetFileInput = useCallback(() => {
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  /** After `key` remounts the input, force-empty in the same commit so the ref always matches a fresh element. */
  useLayoutEffect(() => {
    resetFileInput()
  }, [fileInputKey, resetFileInput])

  const stageFiles = useCallback((fileList) => {
    if (!fileList?.length) return
    setPendingItems((prev) => {
      revokePendingPreviewUrls(prev)
      return Array.from(fileList).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }))
    })
  }, [])

  const clearPending = useCallback(() => {
    const prev = pendingItemsRef.current
    revokePendingPreviewUrls(prev)
    pendingItemsRef.current = []
    setPendingItems([])
    setFileInputKey((k) => k + 1)
  }, [])

  /** Open picker after layout — double rAF waits for post-upload remount + ref attach (setTimeout(0) alone was flaky). */
  const openFilePicker = useCallback(() => {
    if (uploadInFlightRef.current) return
    resetFileInput()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inputRef.current?.click()
      })
    })
  }, [resetFileInput])

  const chooseDifferentFiles = useCallback(() => {
    clearPending()
    setTimeout(() => {
      inputRef.current?.click()
    }, 0)
  }, [clearPending])

  useEffect(() => {
    const onSidebarPick = () => openFilePicker()
    window.addEventListener(OPEN_UPLOAD_PICKER_EVENT, onSidebarPick)
    return () => window.removeEventListener(OPEN_UPLOAD_PICKER_EVENT, onSidebarPick)
  }, [openFilePicker])

  useEffect(() => {
    if (!location.state?.openFilePicker) return
    openFilePicker()
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state, location.pathname, navigate, openFilePicker])

  useEffect(() => {
    if (location.hash === '#library') {
      requestAnimationFrame(() => {
        document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [location.pathname, location.hash])

  const processFiles = useCallback(
    async (fileList) => {
      if (!fileList?.length) return
      const files = Array.from(fileList)
      for (const file of files) {
        const jobId = crypto.randomUUID()
        setJobs((j) => [
          ...j,
          {
            id: jobId,
            name: file.name,
            size: file.size,
            progress: 0,
            status: 'uploading',
            step: steps[0],
          },
        ])
        try {
          setJobs((j) =>
            j.map((x) =>
              x.id === jobId ? { ...x, progress: 4, step: steps[0] } : x,
            ),
          )
          await uploadFileToFirebase(file, (pct) => {
            const mapped = 4 + (pct / 100) * 91
            const step = pct < 92 ? steps[0] : pct < 100 ? steps[1] : steps[1]
            setJobs((j) =>
              j.map((x) =>
                x.id === jobId
                  ? { ...x, progress: mapped, step }
                  : x,
              ),
            )
          })
          setJobs((j) =>
            j.map((x) =>
              x.id === jobId
                ? { ...x, status: 'done', progress: 100, step: steps[3] }
                : x,
            ),
          )
        } catch (err) {
          setJobs((j) =>
            j.map((x) =>
              x.id === jobId
                ? {
                    ...x,
                    status: 'error',
                    error: err?.message ?? 'Upload failed',
                  }
                : x,
            ),
          )
        }
      }
    },
    [uploadFileToFirebase],
  )

  const confirmPendingAndUpload = useCallback(() => {
    /**
     * Snapshot + clear outside `setPendingItems(updater)` so Strict Mode does not run uploads twice.
     * Sync `pendingItemsRef` immediately so staging the next file cannot see stale pending rows.
     */
    const prev = pendingItemsRef.current
    if (prev.length === 0 || uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    const files = prev.map((p) => p.file)
    revokePendingPreviewUrls(prev)
    setPendingItems([])
    pendingItemsRef.current = []
    setUploadBatchBusy(true)

    void (async () => {
      try {
        await processFiles(files)
      } catch (err) {
        console.error('[confirm upload]', err)
      } finally {
        /**
         * Short delay so React commits and the browser finishes Storage callbacks before we remount
         * the file input — avoids the next `change` / `.click()` silently failing until full reload.
         */
        setTimeout(() => {
          uploadInFlightRef.current = false
          setUploadBatchBusy(false)
          resetFileInput()
          setFileInputKey((k) => k + 1)
        }, 32)
      }
    })()
  }, [processFiles, resetFileInput])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragOver(false)
      stageFiles(e.dataTransfer.files)
    },
    [stageFiles],
  )

  const activeCount = jobs.filter((q) => q.status === 'uploading').length
  const completedToday = jobs.filter((q) => q.status === 'done').length

  return (
    <div className="relative pb-16">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Upload Center</h1>
        <p className="mt-1 text-sm text-slate-600">
          Files you confirm are uploaded <strong>as-is</strong> (same name and format) to <strong>Firebase Storage</strong>.
          <strong> Firestore</strong> keeps metadata in the{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">user_files</code> collection for the Library. OCR in the Library
          supports raster images and PDF (first page).
        </p>
        {!isFirebaseConfigured && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Firebase is not configured. Add your <code className="text-xs">VITE_*</code> keys in <code className="text-xs">.env</code> and restart the dev server.
          </p>
        )}
        {isFirebaseConfigured && !isStorageReady && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            <strong>Storage is not connected.</strong> Set <code className="rounded bg-red-100 px-1 text-xs">VITE_FIREBASE_STORAGE_BUCKET</code> to the
            exact bucket from Firebase → Project settings → Your apps (often <code className="text-xs">*.firebasestorage.app</code>), enable Storage in the
            console, deploy <code className="text-xs">storage.rules</code>, then restart <code className="text-xs">npm run dev</code>. Without this, uploads
            cannot run and nothing will appear in the Library.
          </p>
        )}
      </div>

      <div
        role={pendingItems.length > 0 ? 'region' : 'button'}
        tabIndex={pendingItems.length > 0 ? undefined : 0}
        aria-label={pendingItems.length > 0 ? 'Review files before upload' : 'Upload drop zone'}
        onKeyDown={(e) =>
          pendingItems.length === 0 &&
          !uploadBatchBusy &&
          e.key === 'Enter' &&
          openFilePicker()
        }
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={[
          'rounded-2xl border-2 border-dashed p-5 text-center transition sm:p-8 md:p-12',
          dragOver ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 bg-white',
        ].join(' ')}
      >
        <input
          key={fileInputKey}
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.heic,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => {
            const list = e.target.files
            stageFiles(list)
            e.target.value = ''
          }}
        />

        {pendingItems.length > 0 ? (
          <div className="text-left">
            <p className="text-center text-lg font-semibold text-slate-900">Review before upload</p>
            <p className="mt-2 text-center text-sm text-slate-500">
              {pendingItems.length === 1
                ? 'Confirm to upload this file to Firebase Storage in its original format.'
                : `Confirm to upload ${pendingItems.length} files to Firebase Storage in their original formats.`}
            </p>

            <div className="mx-auto mt-6 grid max-h-80 w-full max-w-3xl grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
              {pendingItems.map((item) => (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
                >
                  {item.previewUrl ? (
                    <img
                      key={item.previewUrl}
                      src={item.previewUrl}
                      alt=""
                      className="mx-auto max-h-56 w-full object-contain"
                    />
                  ) : (
                    <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 px-4 py-6">
                      <FileText className="h-14 w-14 text-indigo-400" aria-hidden />
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Document
                      </span>
                    </div>
                  )}
                  <div className="border-t border-slate-200 bg-white px-3 py-2">
                    <p className="truncate text-sm font-medium text-slate-900">{item.file.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatUploadSize(item.file.size)}
                      {item.file.type ? ` · ${item.file.type}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                disabled={uploadBatchBusy}
                onClick={(e) => {
                  e.stopPropagation()
                  confirmPendingAndUpload()
                }}
                className="w-full min-w-[140px] rounded-xl bg-indigo-600 px-8 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {uploadBatchBusy ? 'Uploading…' : 'OK — upload'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  clearPending()
                  resetFileInput()
                }}
                className="w-full min-w-[140px] rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  chooseDifferentFiles()
                }}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                Choose different files
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100">
              <Upload className="h-8 w-8 text-indigo-600" />
            </div>
            <p className="mt-4 text-lg font-semibold text-slate-900">Drop your files here</p>
            <p className="mt-2 text-sm text-slate-500">
              Most common types are accepted; files are stored unchanged. Path pattern{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">users/your-uid/…</code> in Firebase Storage.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                disabled={uploadBatchBusy}
                onClick={() => openFilePicker()}
                className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadBatchBusy ? 'Uploading…' : 'Upload Files'}
              </button>
              <button
                type="button"
                onClick={() =>
                  window.alert(
                    'Cloud drive integration will connect here when your backend API is ready.',
                  )
                }
                className="rounded-xl bg-violet-100 px-6 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-violet-200"
              >
                Connect Cloud Drive
              </button>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-6 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Cloud className="h-3.5 w-3.5" /> Firebase Storage
              </span>
              <span>AI Ready</span>
              <span>Compliance Checked</span>
            </div>
          </>
        )}
      </div>

      <div className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Processing Queue</h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              title="Remove all rows from this list only (does not delete files from Firebase)"
              onClick={() => {
                if (
                  jobs.length === 0 ||
                  window.confirm(
                    'Clear this session’s upload queue from the screen? Your files in Library / Storage are not deleted.',
                  )
                ) {
                  setJobs([])
                  try {
                    sessionStorage.removeItem(SESSION_JOBS_KEY)
                  } catch {
                    /* ignore */
                  }
                }
              }}
            >
              <ListX className="h-4 w-4" />
              Clear queue
            </button>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-800">
              {activeCount} Active
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {completedToday} Completed (session)
            </span>
          </div>
        </div>

        <p className="mb-4 text-xs text-slate-500">
          This queue is saved in your browser tab (session). Going to another page and back may still show it;
          use <strong>Clear queue</strong> only to tidy the list. Successful uploads always appear under{' '}
          <strong>Recent cloud uploads</strong> and in the <Link to="/upload#library" className="text-indigo-600 underline">Library</Link> section below.
        </p>
        <p className="mb-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <strong>Steps:</strong> <span className="uppercase">Uploading to cloud</span> sends your original file bytes to
          Storage. <span className="uppercase">Finalizing</span> writes the Library row in Firestore.{' '}
          <span className="uppercase">Complete</span> means the file is available in the{' '}
          <Link to="/upload#library" className="font-medium text-indigo-600 underline">Library</Link> section (use{' '}
          <strong>Sync library</strong> below if the list looks empty).
        </p>

        <ul className="space-y-3">
          {jobs.length === 0 ? (
            <li className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              No uploads in this session yet. Add files above — they sync to Firestore and Storage.
            </li>
          ) : (
            jobs.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <FileText className="h-10 w-10 shrink-0 text-indigo-500" />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate font-medium text-slate-900 ${item.status === 'error' ? 'text-red-700' : ''}`}
                  >
                    {item.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(item.size / (1024 * 1024)).toFixed(2)} MB ·{' '}
                    <span className="font-semibold uppercase text-indigo-600">{item.step}</span>
                    {item.error && (
                      <span className="ml-2 text-red-600">{item.error}</span>
                    )}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-semibold text-slate-700">
                  {Math.round(item.progress)}%
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-full p-2 text-slate-400"
                    aria-label="Pause"
                    disabled
                  >
                    <Pause className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobs((j) => j.filter((x) => x.id !== item.id))}
                    className="rounded-full p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove from list"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      <section
        id="library"
        className="scroll-mt-8 mt-16 border-t border-slate-200 pt-12"
        aria-labelledby="upload-library-heading"
      >
        <h2 id="upload-library-heading" className="text-2xl font-bold text-slate-900">
          Library
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Browse, filter, and manage workspace and cloud files. Primary <strong>Delete</strong> on cloud rows removes
          the file from Storage and everywhere in the app.
        </p>
        <div className="mt-8">
          <LibrarySection />
        </div>
      </section>

      <button
        type="button"
        disabled={uploadBatchBusy}
        onClick={() => openFilePicker()}
        className="fixed bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:bottom-8 sm:right-8 sm:h-14 sm:w-14"
        aria-label="Quick upload"
      >
        <Plus className="h-7 w-7" />
      </button>
    </div>
  )
}
