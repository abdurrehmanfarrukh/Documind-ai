import { Link, useNavigate } from 'react-router-dom'
import { Search, Bell, History, LifeBuoy, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const placeholderByPath = {
  default: 'Search documents, AI insights, or folders...',
  '/upload': 'Search uploads, library files, or processing history...',
}

export function TopBar({ pathKey = 'default' }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const placeholder =
    placeholderByPath[pathKey] ?? placeholderByPath.default

  return (
    <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          to="/support"
          className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:flex"
        >
          <LifeBuoy className="h-4 w-4" />
          Support
        </Link>
        <button
          type="button"
          className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        </button>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="History"
        >
          <History className="h-5 w-5" />
        </button>
        <div
          className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-bold text-white ring-2 ring-white"
          title={user?.email ?? 'User'}
        >
          {(user?.name ?? user?.email ?? 'U').slice(0, 1).toUpperCase()}
        </div>
        <button
          type="button"
          onClick={() => {
            logout()
            navigate('/login', { replace: true })
          }}
          className="ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
