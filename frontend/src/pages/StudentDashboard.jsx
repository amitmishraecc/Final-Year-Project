import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  CircularProgress,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  TextField,
  Typography,
  Button,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import StatCard from "../components/StatCard";
import StudentAssessmentModule from "../components/StudentAssessmentModule";
import RoleCalendarWidget from "../components/RoleCalendarWidget";
import { apiFetch } from "../lib/api";
import { notifyNewItems, requestNotificationPermissionOnce } from "../lib/webNotify";

function StudentDashboard() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [profile, setProfile] = useState({ username: "", role: "", name: "", profile_image: "" });

  const [overview, setOverview] = useState({
    attendance_percentage: 0,
    average_marks: 0,
    average_assignment_score: 0,
    average_co_curricular_score: 0,
    weighted_score: 0,
    grade: "-",
  });
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [notices, setNotices] = useState([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [subjectOverview, setSubjectOverview] = useState({
    subjects_count: 0,
    average_subject_attendance: 0,
    best_subject: null,
    weak_subject: null,
    subjects: [],
  });
  const [assignmentData, setAssignmentData] = useState({ common: [], personal: [] });
  const [assignmentPreviewOpen, setAssignmentPreviewOpen] = useState(false);
  const [assignmentPreview, setAssignmentPreview] = useState(null);
  const [pageView, setPageView] = useState("overview");

  const riskLevel = useMemo(() => {
    const score = Number(overview.weighted_score || 0);
    if (score >= 80) return "Low Risk";
    if (score >= 60) return "Moderate Risk";
    return "High Risk";
  }, [overview.weighted_score]);

  const filteredSubjects = useMemo(() => {
    const q = subjectFilter.trim().toLowerCase();
    if (!q) return subjectOverview.subjects || [];
    return (subjectOverview.subjects || []).filter((item) =>
      `${item.subject_code || ""} ${item.subject_name || ""} ${item.teacher_username || ""} ${item.subject_type || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [subjectOverview.subjects, subjectFilter]);

  const unreadCount = useMemo(
    () => notices.filter((item) => !item.is_read).length,
    [notices]
  );

  const calendarClassOptions = useMemo(() => {
    if (!profile.class_name || !profile.section) return [];
    return [{ class_name: profile.class_name, section: profile.section }];
  }, [profile.class_name, profile.section]);

  const logout = () => {
    localStorage.clear();
    navigate("/");
  };

  const openNotices = async () => {
    setNoticeOpen(true);
    if (!unreadCount) return;
    try {
      await apiFetch("/notices/student/read-all", { method: "POST" });
      setNotices((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch {
      // keep current state if read-sync fails
    }
  };

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const getAssignmentHtml = (item) => {
    const content = String(item?.content_html || "").trim();
    if (content) return content;
    return `<h2>${escapeHtml(item?.title || "Assignment")}</h2><p><strong>Topic:</strong> ${escapeHtml(
      item?.topic || "-"
    )}</p><p>${escapeHtml(item?.question || "")}</p>`;
  };

  const openAssignmentPreview = (item) => {
    setAssignmentPreview(item);
    setAssignmentPreviewOpen(true);
  };

  const downloadAssignmentDoc = (item) => {
    const html = `<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>${getAssignmentHtml(item)}</body></html>`;
    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = String(item?.title || "assignment").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    a.href = url;
    a.download = `${safeTitle || "assignment"}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };


  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError("");
      try {
        const [overviewData, historyData, subjectData, noticesData, studentAssignments] = await Promise.all([
          apiFetch("/performance/student/overview"),
          apiFetch("/student/attendance/history"),
          apiFetch("/academic/student/subject-overview"),
          apiFetch("/notices/student"),
          apiFetch("/student/assignments"),
        ]);
        const profileData = await apiFetch("/profile/me");

        setOverview(overviewData || {});
        setAttendanceHistory(Array.isArray(historyData) ? historyData : []);
        setSubjectOverview(subjectData || {});
        setNotices(Array.isArray(noticesData) ? noticesData : []);
        setAssignmentData(studentAssignments || { common: [], personal: [] });
        setProfile(profileData || {});
      } catch (err) {
        setError(err.message || "Failed to load student dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!profile.username) return;
    requestNotificationPermissionOnce(`web_notify_prompted_student_${profile.username}`);
  }, [profile.username]);

  useEffect(() => {
    if (!profile.username || !Array.isArray(notices)) return;
    notifyNewItems({
      items: notices,
      storageKey: `web_notify_seen_student_${profile.username}`,
      title: "New Student Notice",
      getBody: (item) => `${item?.title || "Notice"}: ${item?.body || ""}`.slice(0, 180),
    });
  }, [notices, profile.username]);

  return (
    <Container sx={{ py: 3 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4">Student Overview</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton color="primary" onClick={openNotices}>
            <Badge badgeContent={unreadCount} color="error">
              <NotificationsIcon />
            </Badge>
          </IconButton>
          <Typography variant="body1">{profile.name || profile.username || "Student"}</Typography>
          <Button variant="outlined" onClick={logout}>Logout</Button>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Button variant={pageView === "overview" ? "contained" : "outlined"} onClick={() => setPageView("overview")}>Overview</Button>
        <Button variant={pageView === "subjects" ? "contained" : "outlined"} onClick={() => setPageView("subjects")}>Subjects</Button>
        <Button variant={pageView === "attendance" ? "contained" : "outlined"} onClick={() => setPageView("attendance")}>Attendance</Button>
        <Button variant={pageView === "assignments" ? "contained" : "outlined"} onClick={() => setPageView("assignments")}>Assignments</Button>
        <Button variant={pageView === "assessments" ? "contained" : "outlined"} onClick={() => setPageView("assessments")}>AI Assessments</Button>
      </Box>

      <Box>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {unreadCount > 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                You have {unreadCount} unread notice(s). Click the top-right notice icon to view.
              </Alert>
            )}

            {(pageView === "overview" || pageView === "subjects" || pageView === "attendance" || pageView === "assignments" || pageView === "assessments") && (
              <Grid container spacing={2} sx={{ mb: 1 }}>
                <Grid item xs={12} md={3}><StatCard label="Overall Grade" value={overview.grade} /></Grid>
                <Grid item xs={12} md={3}><StatCard label="Weighted Score" value={overview.weighted_score} /></Grid>
                <Grid item xs={12} md={3}><StatCard label="Overall Attendance %" value={overview.attendance_percentage} /></Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Risk Level" value={riskLevel} accent={riskLevel === "High Risk" ? "error.main" : "success.main"} />
                </Grid>
              </Grid>
            )}

            {pageView === "overview" && (
              <>
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                  <Grid item xs={12} md={3}><StatCard label="Subjects" value={subjectOverview.subjects_count || 0} /></Grid>
                  <Grid item xs={12} md={3}><StatCard label="Avg Subject Attendance %" value={subjectOverview.average_subject_attendance || 0} /></Grid>
                  <Grid item xs={12} md={3}><StatCard label="Best Subject" value={subjectOverview.best_subject?.subject_code || "-"} /></Grid>
                  <Grid item xs={12} md={3}><StatCard label="Weak Subject" value={subjectOverview.weak_subject?.subject_code || "-"} accent="error.main" /></Grid>
                </Grid>

                <Card sx={{ mt: 2 }}>
                  <CardContent>
                    <Typography variant="h6" sx={{ mb: 1.5 }}>Current Performance Indicators</Typography>
                    <Typography variant="body2" color="text.secondary">Average Marks: {overview.average_marks}</Typography>
                    <LinearProgress variant="determinate" sx={{ mt: 1, mb: 1.5 }} value={Math.max(0, Math.min(100, Number(overview.average_marks || 0)))} />
                    <Typography variant="body2" color="text.secondary">Assignment Average: {overview.average_assignment_score}</Typography>
                    <LinearProgress variant="determinate" sx={{ mt: 1, mb: 1.5 }} value={Math.max(0, Math.min(100, Number(overview.average_assignment_score || 0)))} />
                    <Typography variant="body2" color="text.secondary">Co-Curricular Average: {overview.average_co_curricular_score}</Typography>
                    <LinearProgress variant="determinate" sx={{ mt: 1 }} value={Math.max(0, Math.min(100, Number(overview.average_co_curricular_score || 0)))} />
                  </CardContent>
                </Card>

                <RoleCalendarWidget role="student" classOptions={calendarClassOptions} />
              </>
            )}

            {pageView === "subjects" && (
              <Card sx={{ mt: 1 }}>
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
                    <Typography variant="h6">Subject-wise Teacher Allotment, Marks & Attendance</Typography>
                    <TextField
                      size="small"
                      label="Filter subject/teacher"
                      value={subjectFilter}
                      onChange={(e) => setSubjectFilter(e.target.value)}
                    />
                  </Box>
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Subject Code</TableCell>
                          <TableCell>Subject Name</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Allotted Teacher</TableCell>
                          <TableCell>Marks %</TableCell>
                          <TableCell>Attendance %</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredSubjects.map((item, idx) => (
                          <TableRow key={`${item.subject_code}-${idx}`}>
                            <TableCell>{item.subject_code}</TableCell>
                            <TableCell>{item.subject_name}</TableCell>
                            <TableCell>{item.subject_type}</TableCell>
                            <TableCell>{item.teacher_username || "Not Assigned"}</TableCell>
                            <TableCell>{item.marks_percentage}</TableCell>
                            <TableCell>{item.attendance_percentage}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            )}

            {pageView === "attendance" && (
              <Card sx={{ mt: 1 }}>
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 1.5 }}>Attendance History</Typography>
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell>Class</TableCell>
                          <TableCell>Section</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {attendanceHistory.map((item, index) => (
                          <TableRow key={`${item.date}-${index}`}>
                            <TableCell>{item.date}</TableCell>
                            <TableCell>{item.class_name}</TableCell>
                            <TableCell>{item.section}</TableCell>
                            <TableCell>{item.status}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            )}

            {pageView === "assignments" && (
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid item xs={12}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" sx={{ mb: 1.5 }}>Assignments - Common</Typography>
                      <TableContainer component={Paper}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Title</TableCell>
                              <TableCell>Subject</TableCell>
                              <TableCell>Teacher</TableCell>
                              <TableCell>Due Date</TableCell>
                              <TableCell>Grade</TableCell>
                              <TableCell>Feedback</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell>Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(assignmentData.common || []).map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>{item.title || "-"}</TableCell>
                                <TableCell>{item.subject_code || "-"}</TableCell>
                                <TableCell>{item.teacher_name || item.teacher_username || "-"}</TableCell>
                                <TableCell>{item.due_date || "-"}</TableCell>
                                <TableCell>{item.grade_score ?? "-"}</TableCell>
                                <TableCell>{item.feedback || "-"}</TableCell>
                                <TableCell>{item.is_completed ? "Completed" : "Pending"}</TableCell>
                                <TableCell>
                                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                    <Button size="small" variant="outlined" onClick={() => openAssignmentPreview(item)}>View</Button>
                                    <Button size="small" variant="outlined" onClick={() => downloadAssignmentDoc(item)}>Download .doc</Button>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" sx={{ mb: 1.5 }}>Assignments - Personal</Typography>
                      <TableContainer component={Paper}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Title</TableCell>
                              <TableCell>Subject</TableCell>
                              <TableCell>Teacher</TableCell>
                              <TableCell>Due Date</TableCell>
                              <TableCell>Grade</TableCell>
                              <TableCell>Feedback</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell>Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(assignmentData.personal || []).map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>{item.title || "-"}</TableCell>
                                <TableCell>{item.subject_code || "-"}</TableCell>
                                <TableCell>{item.teacher_name || item.teacher_username || "-"}</TableCell>
                                <TableCell>{item.due_date || "-"}</TableCell>
                                <TableCell>{item.grade_score ?? "-"}</TableCell>
                                <TableCell>{item.feedback || "-"}</TableCell>
                                <TableCell>{item.is_completed ? "Completed" : "Pending"}</TableCell>
                                <TableCell>
                                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                    <Button size="small" variant="outlined" onClick={() => openAssignmentPreview(item)}>View</Button>
                                    <Button size="small" variant="outlined" onClick={() => downloadAssignmentDoc(item)}>Download .doc</Button>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            )}

            {pageView === "assessments" && (
              <StudentAssessmentModule />
            )}
          </>
        )}
      </Box>

      <Dialog open={assignmentPreviewOpen} onClose={() => setAssignmentPreviewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{assignmentPreview?.title || "Assignment"}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mb: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button size="small" variant="outlined" onClick={() => downloadAssignmentDoc(assignmentPreview)}>Download .doc</Button>
          </Box>
          <Paper variant="outlined" sx={{ p: 2, maxHeight: 480, overflowY: "auto", "& img": { maxWidth: "100%", height: "auto" } }}>
            <Box
              dangerouslySetInnerHTML={{
                __html: getAssignmentHtml(assignmentPreview),
              }}
            />
          </Paper>
        </DialogContent>
      </Dialog>

      <Dialog open={noticeOpen} onClose={() => setNoticeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Notices</DialogTitle>
        <DialogContent dividers>
          {notices.length === 0 ? (
            <Alert severity="success">No new notices</Alert>
          ) : (
            <Box sx={{ display: "grid", gap: 1.5 }}>
              {notices.map((item) => (
                <Alert
                  key={item.id}
                  severity={item.target_type === "student" ? "warning" : "info"}
                  variant="outlined"
                >
                  <Typography variant="subtitle2">{item.title}</Typography>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>{item.body}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.created_at?.slice(0, 10) || "-"} |{" "}
                    {item.target_type === "student"
                      ? `Direct: ${item.student_username}`
                      : item.target_type === "class_section"
                        ? `${item.class_name}-${item.section}`
                        : "All students"}
                  </Typography>
                </Alert>
              ))}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Container>
  );
}

export default StudentDashboard;

