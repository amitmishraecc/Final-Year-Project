import { Routes, Route, Navigate } from "react-router-dom";
import Login from "../pages/Login";
import TeacherDashboard from "../pages/TeacherDashboard";
import StudentDashboard from "../pages/StudentDashboard";

function AppRoutes() {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  return (
    <Routes>
      {!token && <Route path="*" element={<Login />} />}

      {token && role === "teacher" && (
        <Route path="/" element={<TeacherDashboard />} />
      )}

      {token && role === "student" && (
        <Route path="/" element={<StudentDashboard />} />
      )}

      {token && <Route path="*" element={<Navigate to="/" />} />}
    </Routes>
  );
}

export default AppRoutes;
