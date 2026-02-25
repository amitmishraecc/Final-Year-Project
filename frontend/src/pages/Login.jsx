import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!username || !password) {
      setError("Please fill all fields");
      return;
    }

    setLoading(true);
    setError("");

    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

    try {
      const response = await fetch("http://127.0.0.1:8000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || "Login failed");
        return;
      }

      const token = data.access_token;
      localStorage.setItem("token", token);
      const payload = JSON.parse(atob(token.split(".")[1]));
      localStorage.setItem("role", payload.role);

      if (payload.role === "teacher") navigate("/teacher");
      else if (payload.role === "student") navigate("/student");
      else if (payload.role === "admin") navigate("/admin");
      else navigate("/");
    } catch (err) {
      console.error(err);
      setError("Server not reachable");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        px: 2,
        py: 10,
        background: "#f3f7fb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          py: 1.2,
          px: 2,
          textAlign: "center",
          bgcolor: "#0f4d87",
          color: "white",
          zIndex: 1200,
        }}
      >
        <Typography sx={{ fontWeight: 700 }}>
          Lloyd Institute of Engineering and Technology
        </Typography>
      </Box>

      <Card sx={{ width: "100%", maxWidth: 420 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Portal Login
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Sign in to continue
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <TextField
            fullWidth
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            sx={{ mb: 1.5 }}
          />
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            sx={{ mb: 2 }}
          />

          <Button variant="contained" fullWidth onClick={handleLogin} disabled={loading}>
            {loading ? <CircularProgress size={22} color="inherit" /> : "Login"}
          </Button>
        </CardContent>
      </Card>

      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          py: 1.1,
          px: 2,
          textAlign: "center",
          bgcolor: "#0f4d87",
          color: "white",
          zIndex: 1200,
        }}
      >
        <Typography sx={{ fontWeight: 600 }}>
          Amit Mishra | MCA Section A
        </Typography>
      </Box>
    </Box>
  );
}

export default Login;
