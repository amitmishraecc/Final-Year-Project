import { useEffect, useState } from "react";
import { Box, Drawer, List, ListItemButton, ListItemText, Toolbar, AppBar, Typography, Button } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";

const drawerWidth = 220;

function AdminLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [displayName, setDisplayName] = useState("Admin");

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await apiFetch("/profile/me");
        setDisplayName(data?.name || data?.username || "Admin");
      } catch {
        setDisplayName("Admin");
      }
    };
    loadProfile();
  }, []);

  const logout = () => {
    localStorage.clear();
    navigate("/");
  };

  return (
    <Box sx={{ display: "flex" }}>
      
      {/* Top Bar */}
      <AppBar
        position="fixed"
        sx={{
          zIndex: 1201,
          background: "linear-gradient(90deg, #0f3e6a, #13568f)",
          boxShadow: "0 10px 24px rgba(15,62,106,0.25)",
        }}
      >
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            LIET Admin Panel
          </Typography>
          <Typography variant="body1" sx={{ mr: 2 }}>
            {displayName}
          </Typography>
          <Button color="inherit" onClick={logout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            boxSizing: "border-box",
            borderRight: "1px solid #d9e7f6",
            background: "linear-gradient(180deg, #f8fbff, #eef5fd)",
          },
        }}
      >
        <Toolbar />
        <List>
          <ListItemButton
            selected={location.pathname === "/admin"}
            onClick={() => navigate("/admin")}
            sx={{ mx: 1, borderRadius: 2, my: 0.4 }}
          >
            <ListItemText primary="Overview" />
          </ListItemButton>

          <ListItemButton
            selected={location.pathname.startsWith("/admin/teachers")}
            onClick={() => navigate("/admin/teachers")}
            sx={{ mx: 1, borderRadius: 2, my: 0.4 }}
          >
            <ListItemText primary="Manage Teachers" />
          </ListItemButton>

          <ListItemButton
            selected={location.pathname.startsWith("/admin/students")}
            onClick={() => navigate("/admin/students")}
            sx={{ mx: 1, borderRadius: 2, my: 0.4 }}
          >
            <ListItemText primary="Manage Students" />
          </ListItemButton>

          <ListItemButton
            selected={location.pathname.startsWith("/admin/classes")}
            onClick={() => navigate("/admin/classes")}
            sx={{ mx: 1, borderRadius: 2, my: 0.4 }}
          >
            <ListItemText primary="Manage Classes" />
          </ListItemButton>
        </List>
      </Drawer>

      {/* Main Content */}
      <Box component="main" sx={{ flexGrow: 1, p: 3 }} className="soft-fade-up">
        <Toolbar />
        {children}
      </Box>

    </Box>
  );
}

export default AdminLayout;
