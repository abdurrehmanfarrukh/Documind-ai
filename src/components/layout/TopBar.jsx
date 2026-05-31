import { Link, useNavigate } from 'react-router-dom'
import { Search, Bell, History, LifeBuoy, LogOut, Menu } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const placeholderByPath = {
  default: 'Search documents, AI insights, or folders...',
  '/upload': 'Search uploads, library files, or processing history...',
}

export function TopBar({ pathKey = 'default', onMenuClick }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const placeholder =
    placeholderByPath[pathKey] ?? placeholderByPath.default

  return (
    <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
      <button
        type="button"
        onClick={onMenuClick}
        className="shrink-0 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-400 sm:block" />
        <input
          type="search"
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:py-2.5 sm:pl-10 sm:pr-4"
        />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
        <Link
          to="/support"
          className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 md:flex"
        >
          <LifeBuoy className="h-4 w-4" />
          <span className="hidden lg:inline">Support</span>
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
          className="hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 sm:inline-flex"
          aria-label="History"
        >
          <History className="h-5 w-5" />
        </button>
        <div
          className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-bold text-white ring-2 ring-white sm:ml-1 sm:h-9 sm:w-9"
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
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
