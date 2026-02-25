import { Navigate, Route, Routes } from "react-router-dom";
import AdminDashboard from "./AdminDashboard";

function AdminSectionRouter() {
  return (
    <Routes>
      <Route path="/" element={<AdminDashboard mode="dashboard" />} />
      <Route path="/teachers" element={<AdminDashboard mode="teachers" />} />
      <Route path="/students" element={<AdminDashboard mode="students" />} />
      <Route path="/classes" element={<AdminDashboard mode="classes" />} />
      <Route path="/users" element={<Navigate to="/admin/teachers" replace />} />
      <Route path="/assign" element={<Navigate to="/admin/classes" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default AdminSectionRouter;
