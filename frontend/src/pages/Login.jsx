import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
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
        px: { xs: 1.5, md: 3 },
        py: { xs: 2, md: 3 },
        background:
          "radial-gradient(circle at 16% 12%, rgba(112, 176, 255, 0.22), transparent 34%), linear-gradient(160deg, #163f7d 0%, #0f2f5f 55%, #224f92 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 1500,
          minHeight: { xs: "calc(100vh - 24px)", md: "calc(100vh - 40px)" },
          borderRadius: 5,
          overflow: "hidden",
          border: "1px solid rgba(185, 214, 255, 0.32)",
          background:
            "linear-gradient(135deg, rgba(16, 55, 111, 0.92), rgba(31, 78, 145, 0.88) 44%, rgba(159, 198, 255, 0.66) 100%)",
          boxShadow: "0 24px 80px rgba(6, 21, 46, 0.45)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          sx={{
            px: { xs: 2, md: 4 },
            py: { xs: 1.5, md: 2 },
            color: "#deebff",
            background: "linear-gradient(90deg, rgba(13, 46, 97, 0.98), rgba(37, 78, 143, 0.9))",
            borderBottom: "1px solid rgba(198, 220, 255, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography
            sx={{
              fontFamily: "'Sora', sans-serif",
              fontWeight: 700,
              letterSpacing: 0.2,
              fontSize: { xs: "1rem", md: "2.75rem" },
              lineHeight: 1.1,
              textAlign: "center",
            }}
          >
            Lloyd Institute of Engineering and Technology
          </Typography>
        </Box>

        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              flex: { xs: "0 0 auto", md: "0 0 50%" },
              minHeight: { xs: 220, md: "100%" },
              position: "relative",
              overflow: "hidden",
            }}
          >
            <Box
              component="img"
              src="/images/lietlogo.jpeg"
              alt="LIET Campus"
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(12, 42, 84, 0.18), rgba(12, 42, 84, 0.32))",
              }}
            />
          </Box>

          <Box
            sx={{
              flex: { xs: "1 1 auto", md: "0 0 50%" },
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              p: { xs: 2, md: 5 },
            }}
          >
            <Paper
              elevation={0}
              sx={{
                width: "100%",
                maxWidth: 620,
                borderRadius: 4,
                border: "1px solid rgba(198, 214, 240, 0.65)",
                bgcolor: "rgba(252, 254, 255, 0.92)",
                backdropFilter: "blur(8px)",
                p: { xs: 2.2, md: 4 },
              }}
            >
              <Typography
                sx={{
                  fontFamily: "'Sora', sans-serif",
                  fontWeight: 700,
                  fontSize: { xs: "1.55rem", md: "3.2rem" },
                  color: "#1d3765",
                  lineHeight: 1.08,
                  mb: 0.6,
                }}
              >
                Portal Login
              </Typography>
              <Typography
                sx={{
                  color: "#4b5f81",
                  fontSize: { xs: "0.95rem", md: "1.9rem" },
                  mb: { xs: 2, md: 3 },
                }}
              >
                Sign in to your account
              </Typography>

              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

              <TextField
                fullWidth
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonRoundedIcon sx={{ color: "#5874a2" }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  mb: 1.5,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2.8,
                    bgcolor: "rgba(255,255,255,0.85)",
                  },
                }}
              />
              <TextField
                fullWidth
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockRoundedIcon sx={{ color: "#5874a2" }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  mb: 1.25,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2.8,
                    bgcolor: "rgba(255,255,255,0.85)",
                  },
                }}
              />

              <Button
                variant="contained"
                fullWidth
                onClick={handleLogin}
                disabled={loading}
                sx={{
                  py: { xs: 1.15, md: 1.6 },
                  borderRadius: 2.8,
                  fontSize: { xs: "1rem", md: 21 },
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  textTransform: "none",
                  background: "linear-gradient(92deg, #1d4fa0, #3ec2e5)",
                  boxShadow: "0 10px 22px rgba(23, 83, 163, 0.33)",
                }}
              >
                {loading ? <CircularProgress size={22} color="inherit" /> : "Login"}
              </Button>

              <Typography
                sx={{
                  textAlign: "center",
                  mt: 2,
                  color: "#56709b",
                  fontSize: { xs: "0.85rem", md: 15.5 },
                }}
              >
                Need help? <Box component="span" sx={{ color: "#305e9f", fontWeight: 600 }}>Contact support</Box>
              </Typography>
            </Paper>
          </Box>
        </Box>

        <Box
          sx={{
            px: 2,
            py: { xs: 1.1, md: 1.5 },
            textAlign: "center",
            color: "#e0ecff",
            borderTop: "1px solid rgba(184, 209, 244, 0.26)",
            background: "linear-gradient(90deg, rgba(18, 63, 124, 0.9), rgba(48, 103, 184, 0.66))",
          }}
        >
          <Typography sx={{ fontWeight: 500, letterSpacing: 0.2, fontSize: { xs: "0.9rem", md: 34 } }}>
            Amit Mishra | MCA Section A
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}

export default Login;
