import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CloudUpload,
  ShieldCheck,
  BarChart3,
  Settings,
  HelpCircle,
  Plus,
} from 'lucide-react'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'Upload Center', icon: CloudUpload },
  { to: '/verification', label: 'AI Verification', icon: ShieldCheck },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]

const bottomNav = [
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/support', label: 'Support', icon: HelpCircle },
]

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  function handleNewDocument() {
    if (location.pathname === '/upload') {
      window.dispatchEvent(new CustomEvent('docmind-open-upload-picker'))
      return
    }
    navigate('/upload', { state: { openFilePicker: true } })
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <span className="text-lg font-bold">D</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">DocMind AI</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Enterprise Tier
            </p>
          </div>
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

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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
