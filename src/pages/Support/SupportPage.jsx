import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export function SupportPage() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Support</h1>
        <p className="mt-2 text-sm text-slate-600">
          This is a mock support page. Connect your help desk or docs here when the backend is ready.
        </p>
        <div className="mt-6 flex gap-3">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Back to app
            </Link>
          ) : (
            <Link
              to="/login"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
