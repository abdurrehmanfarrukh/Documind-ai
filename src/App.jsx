import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { AppDataProvider } from './context/AppDataContext'
import { UserFilesProvider } from './context/UserFilesContext'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { HomeRedirect } from './routes/HomeRedirect'
import { AppLayout } from './components/layout/AppLayout'
import { LoginPage } from './pages/Login/LoginPage'
import { DashboardPage } from './pages/Dashboard/DashboardPage'
import { UploadCenterPage } from './pages/UploadCenter/UploadCenterPage'
import { PlaceholderPage } from './pages/Placeholder/PlaceholderPage'
import { SupportPage } from './pages/Support/SupportPage'
import { SimpleDocPage } from './pages/Legal/SimpleDocPage'

export default function App() {
  return (
    <AuthProvider>
      <AppDataProvider>
        <UserFilesProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route
              path="/privacy"
              element={
                <SimpleDocPage title="Privacy Policy">
                  <p>Placeholder privacy copy. Replace when legal content is ready.</p>
                </SimpleDocPage>
              }
            />
            <Route
              path="/terms"
              element={
                <SimpleDocPage title="Terms of Service">
                  <p>Placeholder terms. Replace when legal content is ready.</p>
                </SimpleDocPage>
              }
            />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomeRedirect />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="upload" element={<UploadCenterPage />} />
                <Route path="library" element={<Navigate to="/upload#library" replace />} />
                <Route
                  path="settings"
                  element={
                    <PlaceholderPage
                      title="Settings"
                      description="Org preferences, API keys, and billing — stub until backend exists."
                    />
                  }
                />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
        </UserFilesProvider>
      </AppDataProvider>
    </AuthProvider>
  )
}
