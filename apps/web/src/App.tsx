import { Navigate, Route, Routes } from "react-router-dom"

import { RequireAuth } from "@/components/require-auth"
import { RootLayout } from "@/components/root-layout"
import { ChatScreen } from "@/routes/chat"
import { DashboardScreen } from "@/routes/dashboard"
import { DocumentsScreen } from "@/routes/documents"
import { LandingScreen } from "@/routes/landing"
import { LoginScreen } from "@/routes/login"

export function App() {
  return (
    <Routes>
      {/* Public: the marketing page owns "/", the app lives under /app. */}
      <Route index element={<LandingScreen />} />
      <Route path="/login" element={<LoginScreen />} />

      {/* Everything below the guard requires a valid session (ADR-0002). */}
      <Route element={<RequireAuth />}>
        <Route element={<RootLayout />}>
          <Route path="app" element={<DashboardScreen />} />
          <Route path="p/:projectId" element={<Navigate to="chat" replace />} />
          <Route path="p/:projectId/documents" element={<DocumentsScreen />} />
          <Route path="p/:projectId/chat" element={<ChatScreen />} />
          <Route path="p/:projectId/chat/:chatId" element={<ChatScreen />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
