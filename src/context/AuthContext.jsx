import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
} from 'react'
import {
  onAuthStateChanged,
  signOut,
  signInWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../lib/firebase'

const AuthContext = createContext(null)

function mapFirebaseUser(fbUser) {
  const providerId = fbUser.providerData[0]?.providerId ?? 'password'
  let provider = 'email'
  if (providerId.includes('google')) provider = 'google'
  if (providerId.includes('facebook')) provider = 'facebook'
  return {
    id: fbUser.uid,
    email: fbUser.email,
    name:
      fbUser.displayName ||
      fbUser.email?.split('@')[0] ||
      'User',
    photoURL: fbUser.photoURL,
    provider,
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false)
      return
    }
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser ? mapFirebaseUser(fbUser) : null)
      setAuthLoading(false)
    })
    return () => unsub()
  }, [])

  const loginWithGoogle = useCallback(async () => {
    if (!auth) throw new Error('Firebase is not configured.')
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    await signInWithPopup(auth, provider)
  }, [])

  const loginWithFacebook = useCallback(async () => {
    if (!auth) throw new Error('Firebase is not configured.')
    const provider = new FacebookAuthProvider()
    await signInWithPopup(auth, provider)
  }, [])

  const loginWithEmailPassword = useCallback(async (email, password) => {
    if (!auth) throw new Error('Firebase is not configured.')
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password)
    } catch (e) {
      if (e?.code === 'auth/email-already-in-use') {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      } else {
        throw e
      }
    }
  }, [])

  const logout = useCallback(async () => {
    if (!auth) return
    await signOut(auth)
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      authLoading,
      firebaseConfigured: isFirebaseConfigured,
      loginWithGoogle,
      loginWithFacebook,
      loginWithEmailPassword,
      logout,
    }),
    [
      user,
      authLoading,
      loginWithGoogle,
      loginWithFacebook,
      loginWithEmailPassword,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
