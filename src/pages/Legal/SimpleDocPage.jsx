import { Link } from 'react-router-dom'

export function SimpleDocPage({ title, children }) {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Link to="/login" className="text-sm text-indigo-600 hover:underline">
          ← Back
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">{title}</h1>
        <div className="prose prose-sm mt-4 text-slate-600">{children}</div>
      </div>
    </div>
  )
}
