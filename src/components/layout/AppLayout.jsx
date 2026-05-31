import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

const pathToKey = {
  '/upload': '/upload',
}

export function AppLayout() {
  const { pathname } = useLocation()
  const pathKey = pathToKey[pathname] ?? 'default'

  return (
    <div className="flex h-screen min-h-0 bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar pathKey={pathKey} />
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
