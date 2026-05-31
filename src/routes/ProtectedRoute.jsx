import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppData } from '../context/AppDataContext'
import { LoadingScreen } from '../components/LoadingScreen'

export function ProtectedRoute() {
  const { isAuthenticated, authLoading } = useAuth()
  const { dataLoading } = useAppData()

  if (authLoading) {
    return <LoadingScreen message="Checking your session…" />
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  if (dataLoading) {
    return <LoadingScreen message="Syncing your workspace…" />
  }
  return <Outlet />
}
