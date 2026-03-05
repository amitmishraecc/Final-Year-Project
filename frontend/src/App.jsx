import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import TeacherDashboard from "./pages/TeacherDashboard";
import StudentDashboard from "./pages/StudentDashboard";
import AdminLayout from "./layouts/AdminLayout";
import Attendance from "./pages/Attendence";
import AdminSectionRouter from "./pages/AdminSectionRouter";
import PeriodAttendance from "./pages/PeriodAttendance";

function App() {
  return (
    <Router>
      <Routes>

        <Route path="/" element={<Login />} />

        {/* ADMIN */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allowedRole="admin">
              <AdminLayout>
                <AdminSectionRouter />
              </AdminLayout>
            </ProtectedRoute>
          }
        />

        {/* TEACHER */}
        <Route
          path="/teacher"
          element={
            <ProtectedRoute allowedRole="teacher">
              <TeacherDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/attendance/:class_name/:section"
          element={
            <ProtectedRoute allowedRole="teacher">
              <Attendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/period-attendance/:class_name/:section"
          element={
            <ProtectedRoute allowedRole="teacher">
              <PeriodAttendance />
            </ProtectedRoute>
          }
        />

        {/* STUDENT */}
        <Route
          path="/student"
          element={
            <ProtectedRoute allowedRole="student">
              <StudentDashboard />
            </ProtectedRoute>
          }
        />

      </Routes>
    </Router>
  );
}

export default App;
