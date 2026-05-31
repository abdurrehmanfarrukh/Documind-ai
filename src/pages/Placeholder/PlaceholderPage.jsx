import { Link } from 'react-router-dom'

export function PlaceholderPage({ title, description }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-slate-600">
        {description ?? 'This section is a shell for your upcoming backend and analytics. Navigation works; plug in real data later.'}
      </p>
      <Link to="/dashboard" className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:underline">
        Back to Dashboard
      </Link>
    </div>
  )
}
