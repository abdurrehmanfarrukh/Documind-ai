import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

const pathToKey = {
  '/upload': '/upload',
}

export function AppLayout() {
  const { pathname } = useLocation()
  const pathKey = pathToKey[pathname] ?? 'default'
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-slate-50">
      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close navigation menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar pathKey={pathKey} onMenuClick={() => setSidebarOpen(true)} />
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
