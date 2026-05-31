import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CloudUpload,
  Settings,
  HelpCircle,
  Plus,
  X,
} from 'lucide-react'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'Upload Center', icon: CloudUpload },
]

const bottomNav = [
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/support', label: 'Support', icon: HelpCircle },
]

export function Sidebar({ open = false, onClose }) {
  const navigate = useNavigate()
  const location = useLocation()

  function handleNewDocument() {
    onClose?.()
    if (location.pathname === '/upload') {
      window.dispatchEvent(new CustomEvent('docmind-open-upload-picker'))
      return
    }
    navigate('/upload', { state: { openFilePicker: true } })
  }

  return (
    <aside
      className={[
        'fixed inset-y-0 left-0 z-50 flex h-full w-64 max-w-[min(85vw,16rem)] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ease-out',
        'lg:static lg:z-auto lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none',
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ].join(' ')}
    >
      <div className="border-b border-slate-100 px-4 py-5 sm:px-5 sm:py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <span className="text-lg font-bold">D</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">DocMind AI</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Enterprise Tier
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={handleNewDocument}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:from-blue-900 hover:to-blue-950"
        >
          <Plus className="h-4 w-4" />
          New Document
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              ].join(' ')
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-100 px-3 py-4">
        {bottomNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              [
                'mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50',
              ].join(' ')
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </div>
    </aside>
  )
}
