/**
 * Dashboard-only "secondary delete": hide a cloud file row on the Dashboard without
 * removing it from Firestore / Library (stored per user in localStorage).
 */

const PREFIX = 'docmind_dashboard_hidden_user_file_ids_v1'

/** @param {string | undefined} uid */
function storageKey(uid) {
  return `${PREFIX}:${uid ?? 'anonymous'}`
}

/** @param {string | undefined} uid */
export function getHiddenCloudDocIds(uid) {
  if (!uid) return new Set()
  try {
    const raw = localStorage.getItem(storageKey(uid))
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x) => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

/** @param {string | undefined} uid @param {string} firestoreDocId */
export function hideCloudDocOnDashboard(uid, firestoreDocId) {
  if (!uid || !firestoreDocId) return
  const s = getHiddenCloudDocIds(uid)
  s.add(firestoreDocId)
  localStorage.setItem(storageKey(uid), JSON.stringify([...s]))
}

/** Remove id from the hidden set (e.g. after primary delete from Library). */
export function removeHiddenCloudDocId(uid, firestoreDocId) {
  if (!uid || !firestoreDocId) return
  const s = getHiddenCloudDocIds(uid)
  if (!s.has(firestoreDocId)) return
  s.delete(firestoreDocId)
  localStorage.setItem(storageKey(uid), JSON.stringify([...s]))
}

/** Show all cloud files on the dashboard again (secondary-delete undo). */
export function clearAllHiddenCloudDocIds(uid) {
  if (!uid) return
  try {
    localStorage.removeItem(storageKey(uid))
  } catch {
    /* ignore */
  }
}
