import { Navigate } from 'react-router-dom'
import { useAppData } from '../context/AppDataContext'

export function HomeRedirect() {
  const { isNewUser } = useAppData()
  return <Navigate to={isNewUser ? '/upload' : '/dashboard'} replace />
}
