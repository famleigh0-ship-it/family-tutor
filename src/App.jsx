import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import Home from './pages/Home.jsx'
import Session from './pages/Session.tsx'
import Progress from './pages/Progress.jsx'
import ParentDashboard from './pages/ParentDashboard.jsx'
import ParentStudentDetail from './pages/ParentStudentDetail.jsx'
import ClassroomLog from './pages/ClassroomLog.tsx'
import QuizPrep from './pages/QuizPrep.tsx'
import RoleProtectedRoute from './components/RoleProtectedRoute.jsx'
import RootRedirect from './components/RootRedirect.jsx'
import ParentPinGate from './components/ParentPinGate.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/" element={<RootRedirect />} />

      <Route
        path="/home"
        element={
          <RoleProtectedRoute allowedRole="student">
            <Home />
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/session/:packId"
        element={
          <RoleProtectedRoute allowedRole="student">
            <Session />
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/progress/:packId"
        element={
          <RoleProtectedRoute allowedRole="student">
            <Progress />
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/log/:packId"
        element={
          <RoleProtectedRoute allowedRole="student">
            <ClassroomLog />
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/quiz-prep/:packId"
        element={
          <RoleProtectedRoute allowedRole="student">
            <QuizPrep />
          </RoleProtectedRoute>
        }
      />

      <Route
        path="/parent"
        element={
          <RoleProtectedRoute allowedRole="parent">
            <ParentPinGate>
              <ParentDashboard />
            </ParentPinGate>
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/parent/:studentId"
        element={
          <RoleProtectedRoute allowedRole="parent">
            <ParentPinGate>
              <ParentStudentDetail />
            </ParentPinGate>
          </RoleProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
