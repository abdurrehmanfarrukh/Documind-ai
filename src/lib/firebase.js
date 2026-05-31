import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAnalytics, isSupported } from 'firebase/analytics'

/**
 * Vite injects env at build time. Trim whitespace and strip accidental quotes
 * from .env values (common when pasting from Firebase console).
 */
function envStr(key) {
  const raw = import.meta.env[key]
  if (raw === undefined || raw === null) return ''
  let s = String(raw).trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  return s
}

const measurementId = envStr('VITE_FIREBASE_MEASUREMENT_ID')

const projectId = envStr('VITE_FIREBASE_PROJECT_ID')
/** Must match Firebase Console → Storage. If missing, default GCS name (many projects use *.appspot.com). */
const storageBucketRaw = envStr('VITE_FIREBASE_STORAGE_BUCKET')
const storageBucket =
  storageBucketRaw || (projectId ? `${projectId}.appspot.com` : '')

const firebaseConfig = {
  apiKey: envStr('VITE_FIREBASE_API_KEY'),
  authDomain: envStr('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId,
  storageBucket,
  messagingSenderId: envStr('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: envStr('VITE_FIREBASE_APP_ID'),
  ...(measurementId ? { measurementId } : {}),
}

/** True when required env vars are present (see `.env.example`). */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey.length > 0 && firebaseConfig.projectId.length > 0,
)

let app
let auth
let db
let storage

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  // Point SDK at the exact default bucket (avoids wrong bucket when console uses *.firebasestorage.app)
  if (storageBucket) {
    const gsUrl = storageBucket.startsWith('gs://')
      ? storageBucket
      : `gs://${storageBucket}`
    storage = getStorage(app, gsUrl)
  }
  if (typeof window !== 'undefined' && measurementId) {
    isSupported().then((ok) => {
      if (ok && app) getAnalytics(app)
    })
  }
}

/** False when env is missing bucket or Storage failed to init — uploads will not work. */
export const isStorageReady = Boolean(storage)

export { auth, db, storage }
