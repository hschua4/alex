import { Navigate, Route, Routes } from "react-router-dom"

import { RootLayout } from "@/components/root-layout"
import { ChatScreen } from "@/routes/chat"
import { DashboardScreen } from "@/routes/dashboard"
import { DocumentsScreen } from "@/routes/documents"

export function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route index element={<DashboardScreen />} />
        <Route path="p/:projectId" element={<Navigate to="chat" replace />} />
        <Route path="p/:projectId/documents" element={<DocumentsScreen />} />
        <Route path="p/:projectId/chat" element={<ChatScreen />} />
        <Route path="p/:projectId/chat/:chatId" element={<ChatScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
