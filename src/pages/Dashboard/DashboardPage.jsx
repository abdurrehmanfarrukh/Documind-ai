import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Download, Eye, FileText, Sparkles, Trash2 } from 'lucide-react'
import { useAppData } from '../../context/AppDataContext'
import { useUserFiles } from '../../context/UserFilesContext'
import { useAuth } from '../../context/AuthContext'
import { downloadUploadedFile } from '../../lib/storage/downloadUploadedFile'
import {
  clearAllHiddenCloudDocIds,
  getHiddenCloudDocIds,
  hideCloudDocOnDashboard,
} from '../../lib/dashboardHiddenCloudIds'

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function providerLabel(provider) {
  if (provider === 'google') return 'Google'
  if (provider === 'facebook') return 'Facebook'
  return 'Email / password'
}

/** @param {string | undefined} fileName */
function getPreviewKind(fileName) {
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return null
}

/** @param {unknown} ts */
function formatUploadedAt(ts) {
  try {
    if (ts && typeof ts.toDate === 'function') {
      return ts.toDate().toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    }
    if (ts && typeof ts.seconds === 'number') {
      return new Date(ts.seconds * 1000).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    }
  } catch {
    /* ignore */
  }
  return '—'
}

export function DashboardPage() {
  const { user } = useAuth()
  const { files, stats, queue, dataLoading, dataError } = useAppData()
  const { userFiles, userFilesLoading, userFilesError, refreshUserFiles, saveUserFileMachineIndexText } =
    useUserFiles()
  const [downloadBusyId, setDownloadBusyId] = useState(/** @type {string | null} */ (null))
  const [selectedCloudId, setSelectedCloudId] = useState(/** @type {string | null} */ (null))
  const [draftOcrText, setDraftOcrText] = useState('')
  const [ocrTextDirty, setOcrTextDirty] = useState(false)
  const [ocrSaveBusy, setOcrSaveBusy] = useState(false)
  const [ocrCopyHint, setOcrCopyHint] = useState(false)
  /** Bumps when user hides a file from the dashboard (localStorage) so we re-read hidden ids. */
  const [dashHiddenBump, setDashHiddenBump] = useState(0)

  const visibleUserFiles = useMemo(() => {
    void dashHiddenBump
    const hidden = getHiddenCloudDocIds(user?.id)
    return userFiles.filter((r) => !hidden.has(r.id))
  }, [userFiles, user?.id, dashHiddenBump])

  const hideFileFromDashboardOnly = (firestoreDocId) => {
    hideCloudDocOnDashboard(user?.id, firestoreDocId)
    setDashHiddenBump((n) => n + 1)
  }

  useEffect(() => {
    if (visibleUserFiles.length === 0) {
      setSelectedCloudId(null)
      return
    }
    setSelectedCloudId((prev) => {
      if (prev && visibleUserFiles.some((r) => r.id === prev)) return prev
      return visibleUserFiles[0].id
    })
  }, [visibleUserFiles])

  const selectedCloud = useMemo(
    () =>
      selectedCloudId
        ? visibleUserFiles.find((r) => r.id === selectedCloudId) ?? null
        : null,
    [visibleUserFiles, selectedCloudId],
  )
  const previewKind = selectedCloud ? getPreviewKind(selectedCloud.fileName) : null
  const hasMachineIndex =
    selectedCloud?.machineIndex != null && typeof selectedCloud.machineIndex === 'object'
  const serverOcrText =
    hasMachineIndex && typeof selectedCloud.machineIndex.text === 'string'
      ? selectedCloud.machineIndex.text
      : ''

  useEffect(() => {
    setOcrTextDirty(false)
  }, [selectedCloudId])

  useEffect(() => {
    if (!selectedCloud || ocrTextDirty) return
    setDraftOcrText(serverOcrText)
  }, [selectedCloud, serverOcrText, ocrTextDirty])

  const cloudBytes = useMemo(
    () =>
      userFiles.reduce(
        (s, r) => s + (typeof r.sizeBytes === 'number' && !Number.isNaN(r.sizeBytes) ? r.sizeBytes : 0),
        0,
      ),
    [userFiles],
  )

  const totalStorageBytes = stats.totalBytes + cloudBytes
  /** Unique file ids across workspace + `user_files` (same upload can exist in both after registerUploadedCloudFile). */
  const totalIndexed = useMemo(() => {
    const ids = new Set([
      ...files.map((f) => f.id),
      ...userFiles.map((u) => `cloud-${u.id}`),
    ])
    return ids.size
  }, [files, userFiles])
  const workspaceFileTotal = totalIndexed

  const kpis = useMemo(() => {
    const accBar = stats.fileCount > 0 ? Math.min(100, Math.round(stats.avgConfidence)) : 0
    const hiddenOnDash = userFiles.length - visibleUserFiles.length
    return [
      {
        label: 'Cloud files',
        value: String(visibleUserFiles.length),
        sub:
          hiddenOnDash > 0
            ? `${userFiles.length} total · ${hiddenOnDash} hidden on this page`
            : 'Firebase Storage',
        tone: 'text-emerald-600',
        bar: Math.min(100, visibleUserFiles.length * 15 || 0),
      },
      {
        label: 'Workspace files',
        value: String(workspaceFileTotal),
        sub:
          workspaceFileTotal === 0
            ? 'No files in Library yet'
            : `${files.length} in userData · ${userFiles.length} in user_files`,
        tone: 'text-indigo-600',
        bar: Math.min(100, workspaceFileTotal * 8 || 0),
      },
      {
        label: 'Upload queue',
        value: String(queue.length),
        sub: queue.length ? 'Waiting on Upload Center' : 'Empty',
        tone: queue.length ? 'text-amber-600' : 'text-slate-500',
        bar: Math.min(100, queue.length * 20),
        warn: queue.length > 0,
      },
      {
        label: 'Avg confidence',
        value: stats.fileCount > 0 ? `${stats.avgConfidence.toFixed(1)}%` : '—',
        sub: stats.fileCount > 0 ? 'Workspace OCR mock' : 'Add workspace files',
        tone: 'text-slate-600',
        bar: accBar,
      },
    ]
  }, [
    userFiles.length,
    visibleUserFiles.length,
    files.length,
    workspaceFileTotal,
    stats.fileCount,
    stats.avgConfidence,
    queue.length,
  ])

  /** Merge cloud uploads with local userData files (up to 5) so the list does not vanish when one source is empty. */
  const recent = useMemo(() => {
    const cloud = visibleUserFiles.slice(0, 5).map((r) => ({
      id: `cloud-${r.id}`,
      cloudDocId: r.id,
      name: (r.fileName ?? 'file').replace(/\.[^/.]+$/, ''),
      ext: (r.fileName ?? '').includes('.')
        ? r.fileName.slice(r.fileName.lastIndexOf('.') + 1)
        : 'file',
      fromCloud: true,
      fileUrl: r.fileUrl,
      storagePath: r.storagePath,
      fileName: r.fileName,
      confidence: undefined,
      type: undefined,
    }))
    if (cloud.length >= 5) return cloud
    const need = 5 - cloud.length
    const local = [...files]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, need)
      .map((f) => ({
        ...f,
        fromCloud: false,
      }))
    return [...cloud, ...local]
  }, [visibleUserFiles, files])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Operational Overview</h1>
        <p className="mt-1 text-sm text-slate-600">
          Welcome back{user?.name ? `, ${user.name}` : ''} — your Firebase-backed workspace and cloud
          uploads in one place.
        </p>
        {dataError && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Workspace data:</strong> {dataError} Deploy{' '}
            <code className="rounded bg-amber-100 px-1 text-xs">firestore.rules</code> for{' '}
            <code className="rounded bg-amber-100 px-1 text-xs">userData</code> and refresh.
          </div>
        )}
        {userFilesError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Could not load cloud files:</strong> {userFilesError} Deploy{' '}
            <code className="rounded bg-red-100 px-1 text-xs">firestore.rules</code> for{' '}
            <code className="rounded bg-red-100 px-1 text-xs">user_files</code> in Firebase (Rules tab).
            <button
              type="button"
              onClick={() => void refreshUserFiles()}
              className="ml-2 font-semibold text-red-900 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}
        {(dataLoading || userFilesLoading) && !dataError && !userFilesError && (
          <p className="mt-2 text-sm text-slate-500">Loading workspace and cloud library…</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your account</p>
          <div className="mt-3 flex items-start gap-3">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="h-14 w-14 shrink-0 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700">
                {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{user?.name ?? 'Signed-in user'}</p>
              <p className="truncate text-sm text-slate-600">{user?.email ?? '—'}</p>
              <p className="mt-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Sign-in:</span>{' '}
                {providerLabel(user?.provider)}
              </p>
              {user?.id && (
                <p className="mt-1 font-mono text-[10px] leading-tight text-slate-400">
                  UID: {user.id.slice(0, 8)}…{user.id.slice(-6)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900">{k.value}</span>
                <span className={`text-xs font-medium ${k.tone}`}>{k.sub}</span>
              </div>
              {k.warn && (
                <p className="mt-1 text-xs text-amber-700">Open Upload Center to process the queue.</p>
              )}
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${k.bar}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Your uploaded documents</h2>
            <p className="mt-1 text-sm text-slate-600">
              Cloud files from your account (Firebase Storage + Firestore <code className="rounded bg-slate-100 px-1 text-xs">user_files</code>
              ). After you run OCR in the Library, the <strong>extracted text</strong> appears here so you can edit,
              save, and copy. The original PDF or image stays in Storage. Select a file to preview. Use{' '}
              <strong>Remove from board</strong> to hide a file
              on this page only — it stays in{' '}
              <Link to="/upload#library" className="font-medium text-indigo-600 underline">
                Library
              </Link>
              . To delete everywhere, use <strong>Delete</strong> in Library.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshUserFiles()}
            className="shrink-0 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:underline"
          >
            Sync cloud files
          </button>
        </div>

        {userFiles.length === 0 && userFilesLoading && (
          <p className="mt-6 text-sm text-slate-500">Loading your cloud uploads…</p>
        )}

        {userFiles.length === 0 && !userFilesLoading && (
          <p className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            No cloud uploads yet.{' '}
            <Link to="/upload" className="font-semibold text-indigo-600 hover:underline">
              Go to Upload Center
            </Link>{' '}
            to add documents.
          </p>
        )}

        {userFiles.length > 0 && visibleUserFiles.length === 0 && !userFilesLoading && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-950">
            <p>
              Every cloud file is hidden from this dashboard. Open{' '}
              <Link to="/upload#library" className="font-semibold text-indigo-700 underline">
                Library
              </Link>{' '}
              for the full list.
            </p>
            <button
              type="button"
              onClick={() => {
                clearAllHiddenCloudDocIds(user?.id)
                setDashHiddenBump((n) => n + 1)
              }}
              className="mt-3 text-sm font-semibold text-indigo-700 underline hover:text-indigo-900"
            >
              Show all cloud files on dashboard again
            </button>
          </div>
        )}

        {visibleUserFiles.length > 0 && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <ul className="space-y-2 lg:col-span-5">
              {visibleUserFiles.map((r) => {
                const active = r.id === selectedCloudId
                return (
                  <li key={r.id} className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedCloudId(r.id)}
                      className={[
                        'flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-3 text-left transition',
                        active
                          ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <FileText
                        className={`mt-0.5 h-8 w-8 shrink-0 ${active ? 'text-indigo-600' : 'text-indigo-400'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900">{r.fileName ?? 'file'}</p>
                        <p className="text-xs text-slate-500">
                          {formatUploadedAt(r.timestamp)}
                          {typeof r.sizeBytes === 'number' && !Number.isNaN(r.sizeBytes)
                            ? ` · ${formatBytes(r.sizeBytes)}`
                            : ''}
                          {r.machineIndex && typeof r.machineIndex === 'object' ? (
                            <span className="ml-1 font-medium text-emerald-700"> · OCR text</span>
                          ) : null}
                        </p>
                      </div>
                      <Eye className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Remove from dashboard only (keeps file in Library)"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Remove this file from the dashboard only? It will stay in Library and Storage.',
                          )
                        ) {
                          hideFileFromDashboardOnly(r.id)
                        }
                      }}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white p-3 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                      aria-label="Remove from dashboard"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="flex min-h-[280px] flex-col rounded-xl border border-slate-200 bg-slate-50 lg:col-span-7">
              {selectedCloud && selectedCloud.fileUrl ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                      {selectedCloud.fileName ?? 'Document'}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {previewKind && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                          {previewKind === 'pdf' ? 'PDF' : 'Image'}
                        </span>
                      )}
                      <a
                        href={selectedCloud.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Open in new tab
                      </a>
                      <button
                        type="button"
                        disabled={downloadBusyId === `dash-${selectedCloud.id}`}
                        onClick={async () => {
                          setDownloadBusyId(`dash-${selectedCloud.id}`)
                          try {
                            await downloadUploadedFile({
                              storagePath: selectedCloud.storagePath,
                              fileUrl: selectedCloud.fileUrl,
                              fileName: selectedCloud.fileName ?? 'file',
                            })
                          } catch (e) {
                            window.alert(e?.message ?? 'Download failed')
                          } finally {
                            setDownloadBusyId(null)
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {downloadBusyId === `dash-${selectedCloud.id}` ? 'Downloading…' : 'Download'}
                      </button>
                      <button
                        type="button"
                        title="Remove from this page only"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Remove from dashboard only? The file stays in Library and Storage.',
                            )
                          ) {
                            hideFileFromDashboardOnly(selectedCloud.id)
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove from board
                      </button>
                    </div>
                  </div>

                  {hasMachineIndex ? (
                    <div className="border-b border-slate-200 bg-white px-4 pb-4 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Extracted text (editable)
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {ocrCopyHint ? (
                            <span className="text-xs font-medium text-emerald-700">Copied</span>
                          ) : null}
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(draftOcrText)
                                setOcrCopyHint(true)
                                window.setTimeout(() => setOcrCopyHint(false), 2000)
                              } catch {
                                window.alert('Could not copy to clipboard.')
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy all
                          </button>
                          <button
                            type="button"
                            disabled={!ocrTextDirty || ocrSaveBusy}
                            onClick={async () => {
                              setOcrSaveBusy(true)
                              try {
                                await saveUserFileMachineIndexText(selectedCloud.id, draftOcrText)
                                setOcrTextDirty(false)
                              } catch (e) {
                                window.alert(e?.message ?? 'Could not save text.')
                              } finally {
                                setOcrSaveBusy(false)
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {ocrSaveBusy ? 'Saving…' : 'Save text'}
                          </button>
                        </div>
                      </div>
                      {selectedCloud.machineIndex?.textTruncated ? (
                        <p className="mt-1 text-xs text-amber-800">
                          Stored text was truncated at the OCR step (very long document). Edit and save within the
                          limit shown in the Library.
                        </p>
                      ) : null}
                      <textarea
                        value={draftOcrText}
                        onChange={(e) => {
                          setDraftOcrText(e.target.value)
                          setOcrTextDirty(true)
                        }}
                        spellCheck
                        className="mt-2 min-h-[min(240px,40vh)] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm leading-relaxed text-slate-900 shadow-inner focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        aria-label="Extracted document text"
                      />
                    </div>
                  ) : (previewKind === 'pdf' || previewKind === 'image') && (
                    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      <strong>No OCR text yet.</strong> Open{' '}
                      <Link to="/upload#library" className="font-semibold text-indigo-700 underline">
                        Library
                      </Link>{' '}
                      and run OCR on this file — the readable text will show here and you can copy or edit it.
                    </div>
                  )}

                  <div className="flex flex-1 flex-col overflow-hidden p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Original file
                    </p>
                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                      {previewKind === 'pdf' && (
                        <iframe
                          title={selectedCloud.fileName ?? 'PDF preview'}
                          src={selectedCloud.fileUrl}
                          className="h-[min(520px,70vh)] w-full rounded-lg border border-slate-200 bg-white shadow-sm"
                        />
                      )}
                      {previewKind === 'image' && (
                        <img
                          src={selectedCloud.fileUrl}
                          alt=""
                          className="max-h-[min(520px,70vh)] max-w-full rounded-lg border border-slate-200 bg-white object-contain shadow-sm"
                        />
                      )}
                      {!previewKind && (
                        <div className="flex max-w-md flex-col items-center gap-4 text-center">
                          <FileText className="h-14 w-14 text-slate-300" />
                          <div>
                            <p className="font-medium text-slate-800">No in-browser preview</p>
                            <p className="mt-1 text-sm text-slate-600">
                              This file type cannot be shown here (for example Word or Excel). Use{' '}
                              <strong>Open in new tab</strong> or <strong>Download</strong>.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
                  Select a document from the list.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Recent Document Activity</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void refreshUserFiles()}
                className="text-sm font-medium text-slate-600 hover:text-indigo-600 hover:underline"
              >
                Sync cloud files
              </button>
              <Link to="/upload#library" className="text-sm font-medium text-indigo-600 hover:underline">
                View All
              </Link>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {recent.length === 0 ? (
              <li className="py-8 text-center text-sm text-slate-500">
                No files yet.{' '}
                <Link to="/upload" className="font-medium text-indigo-600 hover:underline">
                  Upload documents
                </Link>
              </li>
            ) : (
              recent.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-3">
                  <FileText className="h-8 w-8 shrink-0 text-indigo-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {f.name}.{f.ext}
                    </p>
                    <p className="text-xs text-slate-500">
                      {f.fromCloud ? (
                        <>
                          Stored in Firebase Storage ·{' '}
                          <button
                            type="button"
                            disabled={downloadBusyId === f.id}
                            onClick={async () => {
                              setDownloadBusyId(f.id)
                              try {
                                await downloadUploadedFile({
                                  storagePath: f.storagePath,
                                  fileUrl: f.fileUrl,
                                  fileName:
                                    f.fileName ??
                                    `${f.name}.${f.ext}`,
                                })
                              } catch (e) {
                                window.alert(e?.message ?? 'Download failed')
                              } finally {
                                setDownloadBusyId(null)
                              }
                            }}
                            className="font-medium text-indigo-600 hover:underline disabled:opacity-50"
                          >
                            {downloadBusyId === f.id ? 'Downloading…' : 'Download'}
                          </button>
                        </>
                      ) : (
                        <>
                          {f.confidence != null && f.type
                            ? `${f.confidence}% confidence · ${f.type.toUpperCase()}`
                            : 'Workspace metadata'}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {f.fromCloud ? 'Cloud' : 'Active'}
                    </span>
                    {f.fromCloud && 'cloudDocId' in f && f.cloudDocId ? (
                      <button
                        type="button"
                        title="Remove from dashboard only"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Remove from dashboard only? File stays in Library.',
                            )
                          ) {
                            hideFileFromDashboardOnly(
                              /** @type {{ cloudDocId: string }} */ (f).cloudDocId,
                            )
                          }
                        }}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                        aria-label="Remove from dashboard"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-800">Quick Drop</p>
            <p className="mt-1 text-xs text-slate-500">
              Drag & drop a single file to process with DocMind AI.
            </p>
            <Link
              to="/upload"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700"
            >
              Automated mode on
            </Link>
          </div>

          <div className="rounded-2xl bg-slate-900 p-5 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-300" />
              <span className="text-sm font-semibold">Intelligence Insight</span>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              DocMind detected patterns in your latest uploads. Generate a compliance summary when your
              API is connected.
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-white py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Generate Report
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-900">Top Metadata Tags</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['#FinOps', '#Tax2024', '#Contracts', '#LegalReview', '#AuditReady'].map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-slate-500">Storage (workspace + cloud)</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {formatBytes(totalStorageBytes)}
            <span className="ml-1 text-sm font-normal text-slate-500">tracked in app</span>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-slate-500">Files indexed</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{totalIndexed}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {files.length} rows in userData · {userFiles.length} in user_files (unique above)
          </p>
        </div>
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white shadow-sm">
          <p className="text-xs font-medium uppercase opacity-90">Current plan</p>
          <p className="mt-1 text-lg font-bold">Enterprise Plus</p>
        </div>
      </div>
    </div>
  )
}
