import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAppData } from '../../context/AppDataContext'
import { Shield } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#1877F2" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function firebaseErrorMessage(err) {
  const code = err?.code ?? ''
  if (code === 'auth/popup-closed-by-user') return 'Sign-in was cancelled.'
  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in is turned off in Firebase. Open Firebase Console → Authentication → Sign-in method → enable Google (and Email/Password if you use it), then try again.'
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return 'This email is already used with another sign-in method.'
  }
  return err?.message ?? 'Something went wrong. Try again.'
}

export function LoginPage() {
  const navigate = useNavigate()
  const {
    loginWithGoogle,
    loginWithFacebook,
    loginWithEmailPassword,
    isAuthenticated,
    firebaseConfigured,
  } = useAuth()
  const { isNewUser, dataLoading } = useAppData()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isAuthenticated && !dataLoading) {
      navigate(isNewUser ? '/upload' : '/dashboard', { replace: true })
    }
  }, [isAuthenticated, dataLoading, isNewUser, navigate])

  async function runAuth(fn) {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(firebaseErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Enter your email.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    await runAuth(() => loginWithEmailPassword(email.trim(), password))
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-violet-50 via-white to-indigo-50">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 40%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
            repeating-radial-gradient(circle at 50% 40%, transparent 0, transparent 40px, rgba(99, 102, 241, 0.04) 40px, rgba(99, 102, 241, 0.04) 41px)`,
        }}
      />

      <header className="relative z-10 px-4 py-4 sm:px-8 sm:py-6">
        <span className="text-base font-bold text-slate-900 sm:text-lg">DocMind AI</span>
      </header>

      <div className="relative z-10 flex min-h-[calc(100dvh-120px)] items-center justify-center px-4 pb-16 sm:pb-24">
        <div className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-xl shadow-indigo-100/50 sm:p-8">
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-violet-100">
              <span className="text-2xl">🧠</span>
            </div>
          </div>

          <h1 className="text-center text-2xl font-bold text-slate-900">Welcome</h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            The Intelligent Canvas for Enterprise Documents
          </p>

          {!firebaseConfigured && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-950">
              <p className="font-semibold">Firebase needs your project keys</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-900/90">
                <li>
                  Open{' '}
                  <a
                    href="https://console.firebase.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-700 underline"
                  >
                    Firebase Console
                  </a>
                  → your project → Project settings (gear) → General → Your apps → Web app. Copy the{' '}
                  <code className="rounded bg-amber-100 px-1 text-xs">firebaseConfig</code> values.
                </li>
                <li>
                  Paste them into the <code className="rounded bg-amber-100 px-1 text-xs">.env</code> file
                  in the project root (same folder as <code className="rounded bg-amber-100 px-1 text-xs">package.json</code>
                  ). Names must stay <code className="rounded bg-amber-100 px-1 text-xs">VITE_FIREBASE_*</code>{' '}
                  as in <code className="rounded bg-amber-100 px-1 text-xs">.env.example</code>.
                </li>
                <li>
                  <strong>Restart the dev server</strong> (stop with Ctrl+C, then run{' '}
                  <code className="rounded bg-amber-100 px-1 text-xs">npm run dev</code> again). Vite only
                  loads <code className="rounded bg-amber-100 px-1 text-xs">.env</code> when it starts.
                </li>
              </ol>
            </div>
          )}

          {step === 1 && (
            <div className="mt-8 space-y-4">
              <p className="text-center text-sm font-medium text-slate-700">
                Sign in with Google or Facebook, or use email
              </p>
              <button
                type="button"
                disabled={busy || !firebaseConfigured}
                onClick={() => runAuth(loginWithGoogle)}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                <GoogleIcon />
                Sign in with Google
              </button>
              <button
                type="button"
                disabled={busy || !firebaseConfigured}
                onClick={() => runAuth(loginWithFacebook)}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                <FacebookIcon />
                Sign in with Facebook
              </button>
              <button
                type="button"
                disabled={busy || !firebaseConfigured}
                onClick={() => {
                  setStep(2)
                  setError('')
                }}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
              >
                Continue with email
              </button>
            </div>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-500">
                Email & password
              </p>
              <p className="text-center text-xs text-slate-500">
                New accounts are created automatically; existing users are signed in.
              </p>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-violet-50/50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="name@company.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-violet-50/50 px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={busy || !firebaseConfigured}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? 'Please wait…' : 'Continue'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep(1)
                  setError('')
                }}
                className="w-full text-center text-sm text-indigo-600 hover:underline"
              >
                Back to social login
              </button>
            </form>
          )}

          {error && step === 1 && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

          <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
            Access your secure workspace and AI-powered document insights with the{' '}
            <span className="font-medium text-indigo-600">Indigo Protocol</span>.
          </p>
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-4 pb-8 sm:px-8">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Shield className="h-4 w-4" />
          Enterprise-grade 256-bit encryption active
        </div>
        <div className="flex w-full max-w-4xl flex-col items-center justify-between gap-4 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:flex-row">
          <span>© {new Date().getFullYear()} DocMind AI. Part of the Indigo Protocol.</span>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/privacy" className="hover:text-indigo-600">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-indigo-600">
              Terms of Service
            </Link>
            <span className="cursor-pointer hover:text-indigo-600">Security</span>
            <Link to="/support" className="hover:text-indigo-600">
              Contact
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
