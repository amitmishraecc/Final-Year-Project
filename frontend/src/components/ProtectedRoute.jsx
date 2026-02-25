import { Navigate } from "react-router-dom";

function ProtectedRoute({ children, allowedRole }) {
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/" replace />;
  }

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const role = payload?.role;
    localStorage.setItem("role", role || "");

    if (allowedRole && role !== allowedRole) {
      if (role === "admin") return <Navigate to="/admin" replace />;
      if (role === "teacher") return <Navigate to="/teacher" replace />;
      if (role === "student") return <Navigate to="/student" replace />;
      localStorage.clear();
      return <Navigate to="/" replace />;
    }

    return children;

  } catch (error) {
    console.error("Invalid token:", error);
    localStorage.clear();
    return <Navigate to="/" replace />;
  }
}

export default ProtectedRoute;
