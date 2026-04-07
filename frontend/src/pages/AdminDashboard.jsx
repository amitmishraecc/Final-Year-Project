import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Grid,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
} from "@mui/material";
import StatCard from "../components/StatCard";
import RoleCalendarWidget from "../components/RoleCalendarWidget";
import { API_BASE, apiFetch } from "../lib/api";
import { notifyNewItems, requestNotificationPermissionOnce } from "../lib/webNotify";

function GraphBars({ title, data = [] }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {title}
        </Typography>
        {data.length === 0 ? (
          <Typography color="text.secondary">No data available</Typography>
        ) : (
          data.map((item) => (
            <Box key={item.label} sx={{ mb: 1.25 }}>
              <Typography variant="body2">
                {item.label}: {item.value}
              </Typography>
              <LinearProgress variant="determinate" value={(item.value / maxValue) * 100} />
            </Box>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AdminDashboard({ mode = "dashboard" }) {
  const token = localStorage.getItem("token");

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [sheetConfigs, setSheetConfigs] = useState([]);
  const [classSections, setClassSections] = useState([]);
  const [subjectAssignments, setSubjectAssignments] = useState([]);
  const [classReport, setClassReport] = useState(null);
  const [classOverview, setClassOverview] = useState(null);

  const [newTeacher, setNewTeacher] = useState({ username: "", password: "" });
  const [newStudent, setNewStudent] = useState({
    username: "",
    password: "",
    roll_no: "",
    name: "",
    class_name: "",
    section: "",
  });
  const [assignData, setAssignData] = useState({ username: "", class_name: "", section: "" });
  const [sheetForm, setSheetForm] = useState({
    teacher_username: "",
    class_name: "",
    section: "",
    sheet_url: "",
  });
  const [reportFilter, setReportFilter] = useState({ class_name: "", section: "" });

  const [classSectionForm, setClassSectionForm] = useState({
    class_name: "",
    section: "",
    program: "",
    semester: "",
  });
  const [subjectForm, setSubjectForm] = useState({
    class_name: "",
    section: "",
    subject_code: "",
    subject_name: "",
    subject_type: "theory",
    max_marks: "100",
  });
  const [subjectAssignForm, setSubjectAssignForm] = useState({
    teacher_username: "",
    class_name: "",
    section: "",
    subject_code: "",
  });
  const [studentImportForm, setStudentImportForm] = useState({
    class_name: "",
    section: "",
    sheet_url: "",
    default_password: "pass123",
  });
  const [timetableForm, setTimetableForm] = useState({
    class_name: "",
    section: "",
    day_of_week: "Monday",
    period_no: "",
    start_time: "",
    end_time: "",
    subject_code: "",
    teacher_username: "",
  });
  const [timetableFilter, setTimetableFilter] = useState({
    class_name: "",
    section: "",
    day_of_week: "",
  });
  const [timetableEntries, setTimetableEntries] = useState([]);
  const [studentViewOpen, setStudentViewOpen] = useState(false);
  const [selectedStudentSnapshot, setSelectedStudentSnapshot] = useState(null);
  const [overviewFilter, setOverviewFilter] = useState({ class_name: "", section: "" });
  const [notices, setNotices] = useState([]);
  const [noticeForm, setNoticeForm] = useState({
    title: "",
    body: "",
    target_type: "all",
    class_name: "",
    section: "",
    student_username: "",
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiForm, setAiForm] = useState({ query: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const aiChatEndRef = useRef(null);
  const [aiChat, setAiChat] = useState([
    {
      role: "bot",
      text: "Hi, I am botmitra. Ask for at-risk students, low attendance or class summaries.",
    },
  ]);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [teacherClassFilter, setTeacherClassFilter] = useState("");
  const [teacherSectionFilter, setTeacherSectionFilter] = useState("");
  const [studentClassFilter, setStudentClassFilter] = useState("");
  const [studentSectionFilter, setStudentSectionFilter] = useState("");
  const aiChatStorageKey = "botmitra_chat_admin";
  const [adminInterventions, setAdminInterventions] = useState([]);

  const showDashboard = mode === "dashboard";
  const showTeachers = mode === "teachers";
  const showStudents = mode === "students";
  const showClasses = mode === "classes";
  const pageTitle = showTeachers
    ? "Manage Teachers"
    : showStudents
      ? "Manage Students"
      : showClasses
        ? "Manage Classes"
        : "Admin Overview";

  const roleDistribution = useMemo(
    () => [
      { label: "Teachers", value: teachers.length },
      { label: "Students", value: students.length },
      { label: "Class Sections", value: classSections.length },
    ],
    [teachers, students, classSections]
  );

  const classStrength = useMemo(() => {
    const map = {};
    students.forEach((student) => {
      const key = `${student.class_name || "NA"}-${student.section || "NA"}`;
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [students]);

  const gradeDistribution = useMemo(() => {
    const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    (classReport?.students || []).forEach((student) => {
      if (dist[student.grade] !== undefined) dist[student.grade] += 1;
    });
    return Object.entries(dist).map(([label, value]) => ({ label, value }));
  }, [classReport]);

  const subjectPerformanceGraph = useMemo(() => {
    const subjects = classOverview?.subjects || [];
    return subjects.map((item) => ({
      label: item.subject_code,
      value: Number(item.average_percentage || 0),
    }));
  }, [classOverview]);

  const subjectTypeDistribution = useMemo(() => {
    const dist = { theory: 0, practical: 0 };
    (classOverview?.subjects || []).forEach((subject) => {
      if (subject.subject_type === "practical") dist.practical += 1;
      else dist.theory += 1;
    });
    return Object.entries(dist).map(([label, value]) => ({ label, value }));
  }, [classOverview]);

  const averageWeightedScore = useMemo(() => {
    const rows = classReport?.students || [];
    if (!rows.length) return 0;
    const total = rows.reduce((sum, item) => sum + Number(item.weighted_score || 0), 0);
    return (total / rows.length).toFixed(2);
  }, [classReport]);

  const calendarClassOptions = useMemo(
    () =>
      (classSections || []).map((item) => ({
        class_name: item.class_name,
        section: item.section,
      })),
    [classSections]
  );

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase();
    return teachers.filter((item) => {
      const usernameMatch = !q || item.username?.toLowerCase().includes(q);
      const classMatch =
        !teacherClassFilter ||
        (item.assigned_classes || []).some(
          (cls) =>
            String(cls.class_name || "").toLowerCase() ===
            teacherClassFilter.trim().toLowerCase()
        );
      const sectionMatch =
        !teacherSectionFilter ||
        (item.assigned_classes || []).some(
          (cls) =>
            String(cls.section || "").toLowerCase() ===
            teacherSectionFilter.trim().toLowerCase()
        );
      return usernameMatch && classMatch && sectionMatch;
    });
  }, [teachers, teacherSearch, teacherClassFilter, teacherSectionFilter]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students.filter((item) =>
      `${item.username || ""} ${item.roll_no || ""} ${item.name || ""}`
        .toLowerCase()
        .includes(q) &&
      (!studentClassFilter ||
        String(item.class_name || "").toLowerCase() ===
          studentClassFilter.trim().toLowerCase()) &&
      (!studentSectionFilter ||
        String(item.section || "").toLowerCase() ===
          studentSectionFilter.trim().toLowerCase())
    );
  }, [students, studentSearch, studentClassFilter, studentSectionFilter]);

  const authHeader = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [teachersData, studentsData, sheetsData, sectionsData, assignmentsData, noticesData, interventionsData] = await Promise.all([
        apiFetch("/admin/teachers"),
        apiFetch("/admin/students"),
        apiFetch("/sheets/configs"),
        apiFetch("/academic/admin/class-sections"),
        apiFetch("/academic/admin/subject-assignments"),
        apiFetch("/notices/admin"),
        apiFetch("/interventions/admin"),
      ]);
      setTeachers(Array.isArray(teachersData) ? teachersData : []);
      setStudents(Array.isArray(studentsData) ? studentsData : []);
      setSheetConfigs(Array.isArray(sheetsData) ? sheetsData : []);
      setClassSections(Array.isArray(sectionsData) ? sectionsData : []);
      setSubjectAssignments(Array.isArray(assignmentsData) ? assignmentsData : []);
      setNotices(Array.isArray(noticesData) ? noticesData : []);
      setAdminInterventions(Array.isArray(interventionsData) ? interventionsData : []);
    } catch {
      setError("Failed to fetch base data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    requestNotificationPermissionOnce("web_notify_prompted_admin");
  }, []);

  useEffect(() => {
    if (!Array.isArray(notices)) return;
    notifyNewItems({
      items: notices,
      storageKey: "web_notify_seen_admin",
      title: "New Admin Notice",
      getBody: (item) => `${item?.title || "Notice"}: ${item?.body || ""}`.slice(0, 180),
    });
  }, [notices]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(aiChatStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setAiChat(parsed);
      }
    } catch {
      // ignore invalid cache
    }
  }, [aiChatStorageKey]);

  useEffect(() => {
    localStorage.setItem(aiChatStorageKey, JSON.stringify(aiChat));
  }, [aiChat, aiChatStorageKey]);

  useEffect(() => {
    if (!aiOpen) return;
    aiChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiChat, aiLoading, aiOpen]);

  const handleApi = async (runner, successMessage) => {
    setError("");
    setMessage("");
    setActionLoading(true);
    try {
      const res = await runner();
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || "Request failed");
        return;
      }
      if (successMessage) setMessage(successMessage(data));
      await fetchAll();
    } catch {
      setError("Server not reachable");
    } finally {
      setActionLoading(false);
    }
  };


  const createTeacher = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/admin/create-teacher`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(newTeacher),
        }),
      () => "Teacher created"
    );

  const createStudent = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/admin/create-student`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(newStudent),
        }),
      () => "Student created"
    );

  const deleteUser = (username) =>
    handleApi(
      () =>
        fetch(`${API_BASE}/admin/delete/${encodeURIComponent(username)}`, {
          method: "DELETE",
          headers: authHeader,
        }),
      () => `${username} deleted`
    );

  const assignClass = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/admin/assign-class`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(assignData),
        }),
      () => "Class assigned to teacher"
    );

  const saveSheetConfig = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/sheets/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(sheetForm),
        }),
      () => "Google Sheet mapping saved"
    );

  const seedDummyData = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/admin/seed-dummy-data`, {
          method: "POST",
          headers: authHeader,
        }),
      (data) => `Dummy seeded: ${data.teachers_created} teachers, ${data.students_created} students`
    );

  const createClassSection = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/academic/admin/class-sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            class_name: classSectionForm.class_name,
            section: classSectionForm.section,
            program: classSectionForm.program || classSectionForm.class_name,
            semester: classSectionForm.semester ? Number(classSectionForm.semester) : null,
          }),
        }),
      () => "Class section saved"
    );

  const addSubject = () =>
    handleApi(
      () =>
        fetch(
          `${API_BASE}/academic/admin/subjects?class_name=${encodeURIComponent(
            subjectForm.class_name
          )}&section=${encodeURIComponent(subjectForm.section)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({
              subject_code: subjectForm.subject_code,
              subject_name: subjectForm.subject_name,
              subject_type: subjectForm.subject_type,
              max_marks: Number(subjectForm.max_marks || 100),
            }),
          }
        ),
      () => "Subject saved"
    );

  const assignSubjectTeacher = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/academic/admin/assign-subject`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(subjectAssignForm),
        }),
      () => "Teacher assigned to subject"
    );

  const importStudentsFromSheet = () =>
    handleApi(
      () =>
        fetch(
          `${API_BASE}/academic/admin/import-students/google-sheet?class_name=${encodeURIComponent(
            studentImportForm.class_name
          )}&section=${encodeURIComponent(studentImportForm.section)}&sheet_url=${encodeURIComponent(
            studentImportForm.sheet_url
          )}&default_password=${encodeURIComponent(studentImportForm.default_password || "pass123")}`,
          { method: "POST", headers: authHeader }
        ),
      (data) => `Imported students: created ${data.created}, updated ${data.updated}`
    );

  const loadClassReport = async () => {
    if (!reportFilter.class_name || !reportFilter.section) {
      setError("Class and section are required");
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/performance/admin/class-report?class_name=${encodeURIComponent(
          reportFilter.class_name
        )}&section=${encodeURIComponent(reportFilter.section)}`,
        { headers: authHeader }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Failed to load class report");
        return;
      }
      setClassReport(data);
      setMessage("Class report loaded");
    } catch {
      setError("Server not reachable");
    }
  };

  const loadClassOverview = async () => {
    if (!overviewFilter.class_name || !overviewFilter.section) {
      setError("Class and section are required for overview");
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/academic/admin/class-overview?class_name=${encodeURIComponent(
          overviewFilter.class_name
        )}&section=${encodeURIComponent(overviewFilter.section)}`,
        { headers: authHeader }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Failed to load class overview");
        return;
      }
      setClassOverview(data);
      setMessage("Class overview loaded");
    } catch {
      setError("Server not reachable");
    }
  };

  const openStudentSnapshot = async (username) => {
    try {
      const data = await apiFetch(`/admin/student-dashboard/${encodeURIComponent(username)}`);
      setSelectedStudentSnapshot(data);
      setStudentViewOpen(true);
    } catch (err) {
      setError(err.message || "Failed to load student dashboard data");
    }
  };

  const saveTimetableEntry = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/academic/admin/timetable`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            ...timetableForm,
            period_no: Number(timetableForm.period_no || 0),
          }),
        }),
      () => "Timetable entry saved"
    );

  const loadTimetableEntries = async () => {
    if (!timetableFilter.class_name || !timetableFilter.section) {
      setError("Class and section are required to load timetable");
      return;
    }
    try {
      const dayQuery = timetableFilter.day_of_week
        ? `&day_of_week=${encodeURIComponent(timetableFilter.day_of_week)}`
        : "";
      const data = await apiFetch(
        `/academic/admin/timetable?class_name=${encodeURIComponent(
          timetableFilter.class_name
        )}&section=${encodeURIComponent(timetableFilter.section)}${dayQuery}`
      );
      setTimetableEntries(Array.isArray(data) ? data : []);
      setMessage("Timetable loaded");
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load timetable");
    }
  };

  const createNotice = () =>
    handleApi(
      () =>
        fetch(`${API_BASE}/notices/admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(noticeForm),
        }),
      () => "Notice published"
    );

  const deleteNotice = (noticeId) =>
    handleApi(
      () =>
        fetch(`${API_BASE}/notices/${encodeURIComponent(noticeId)}`, {
          method: "DELETE",
          headers: authHeader,
        }),
      () => "Notice deleted"
    );

  const runAiQuery = async () => {
    if (!aiForm.query.trim()) {
      setError("Please enter your query");
      return;
    }
    const userMessage = aiForm.query.trim();
    const contextualQuery = buildContextualQuery(userMessage);
    setAiChat((prev) => [...prev, { role: "user", text: userMessage }]);
    setAiForm({ query: "" });
    setAiLoading(true);
    setError("");
    try {
      const data = await apiFetch("/ai/nl-query", {
        method: "POST",
        body: JSON.stringify({
          query: contextualQuery,
        }),
      });
      const botText = formatAiQueryResponse(data);
      setAiChat((prev) => [...prev, { role: "bot", text: botText }]);
    } catch (err) {
      setError(err.message || "Failed to run AI query");
      setAiChat((prev) => [...prev, { role: "bot", text: `Error: ${err.message || "Failed to run AI query"}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  const escalateIntervention = (id) =>
    handleApi(
      () =>
        fetch(`${API_BASE}/interventions/admin/${encodeURIComponent(id)}/escalate`, {
          method: "PATCH",
          headers: authHeader,
        }),
      () => "Intervention escalated"
    );

  const runAiReport = async () => {
    if (!aiForm.query.trim()) {
      setError("Please enter your query");
      return;
    }
    const baseQuery = aiForm.query.trim();
    const userMessage = `Generate report: ${baseQuery}`;
    const contextualQuery = buildContextualQuery(baseQuery);
    setAiChat((prev) => [...prev, { role: "user", text: userMessage }]);
    setAiForm({ query: "" });
    setAiLoading(true);
    setError("");
    try {
      const data = await apiFetch("/ai/nl-report", {
        method: "POST",
        body: JSON.stringify({
          query: contextualQuery,
        }),
      });
      setAiChat((prev) => [...prev, { role: "bot", text: data?.report_text || "No report generated." }]);
    } catch (err) {
      setError(err.message || "Failed to generate AI report");
      setAiChat((prev) => [...prev, { role: "bot", text: `Error: ${err.message || "Failed to generate report"}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  const buildContextualQuery = (currentText) => {
    const recentContext = aiChat
      .slice(-4)
      .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`)
      .join("\n");
    if (!recentContext) return currentText;
    return `Context:\n${recentContext}\n\nCurrent request: ${currentText}`;
  };

  const formatAiQueryResponse = (data) => {
    const result = data?.result;
    const scopeText = Array.isArray(data?.scopes) && data.scopes.length
      ? data.scopes.map((s) => `${s.class_name}-${s.section}`).join(", ")
      : `${data.class_name || "-"}-${data.section || "-"}`;
    if (Array.isArray(result)) {
      if (result.length === 0) return `I checked ${scopeText}. No matching students found.`;
      const lines = result.map((item, idx) => {
        const reasons = Array.isArray(item.reason_codes) ? item.reason_codes.join(", ") : "-";
        return `${idx + 1}. ${item.name || item.username} | ${item.class_name || "-"}-${item.section || "-"} | Risk: ${item.risk_category || "-"} | Attendance: ${item.attendance_percentage ?? "-"}% | Marks: ${item.average_marks ?? "-"} | Reasons: ${reasons}`;
      });
      return `Here are the results for ${scopeText}:\n${lines.join("\n")}`;
    }
    if (result && typeof result === "object") {
      if (result.total_students !== undefined) {
        const lines = (result.breakdown || [])
          .map((b) => `${b.class_name}-${b.section}: ${b.count}`)
          .join(", ");
        return `Total students in ${scopeText}: ${result.total_students}. ${lines ? `Breakdown -> ${lines}.` : ""}`;
      }
      return `Summary for ${scopeText}: students ${result.students ?? 0}, average attendance ${result.average_attendance ?? 0}%, average marks ${result.average_marks ?? 0}. Risk distribution: Good ${result.risk_distribution?.Good ?? 0}, Monitor ${result.risk_distribution?.Monitor ?? 0}, At Risk ${result.risk_distribution?.["At Risk"] ?? 0}, Critical ${result.risk_distribution?.Critical ?? 0}.`;
    }
    return "I could not derive a structured response for this query.";
  };

  return (
    <Container>
      <Typography variant="h4" mt={4} mb={3}>
        {pageTitle}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

      {showDashboard && (
        <>
          <Grid container spacing={2} alignItems="flex-start" sx={{ mb: 4 }}>
            <Grid item xs={12} lg={8}>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={3}><StatCard label="Teachers" value={teachers.length} /></Grid>
                <Grid item xs={12} md={3}><StatCard label="Students" value={students.length} /></Grid>
                <Grid item xs={12} md={3}><StatCard label="Class Sections" value={classSections.length} /></Grid>
                <Grid item xs={12} md={3}><StatCard label="Subject Assignments" value={subjectAssignments.length} /></Grid>
              </Grid>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}><GraphBars title="Role + Master Distribution" data={roleDistribution} /></Grid>
                <Grid item xs={12} md={6}><GraphBars title="Class Strength (Top 8)" data={classStrength} /></Grid>
              </Grid>
            </Grid>
            <Grid item xs={12} lg={4}>
              <Box sx={{ position: { lg: "sticky" }, top: { lg: 24 } }}>
                <RoleCalendarWidget role="admin" classOptions={calendarClassOptions} compact />
              </Box>
            </Grid>
          </Grid>

          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="h6">MongoDB Dummy Seeder (MCA Scenario)</Typography>
                <Button variant="contained" onClick={seedDummyData} disabled={actionLoading}>Seed Dummy Data</Button>
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Intervention Monitor</Typography>
              <Grid container spacing={2} sx={{ mb: 1 }}>
                <Grid item xs={12} md={4}><StatCard label="Total Interventions" value={adminInterventions.length} /></Grid>
                <Grid item xs={12} md={4}><StatCard label="Open/In Progress" value={adminInterventions.filter((i) => ["open", "in_progress"].includes(i.status)).length} /></Grid>
                <Grid item xs={12} md={4}><StatCard label="Escalated" value={adminInterventions.filter((i) => i.escalated).length} accent="error.main" /></Grid>
              </Grid>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Student</TableCell>
                      <TableCell>Class</TableCell>
                      <TableCell>Severity</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {adminInterventions.slice(0, 10).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.name || row.username}</TableCell>
                        <TableCell>{row.class_name}-{row.section}</TableCell>
                        <TableCell>{row.severity}</TableCell>
                        <TableCell>{row.status}</TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={row.escalated}
                            onClick={() => escalateIntervention(row.id)}
                          >
                            {row.escalated ? "Escalated" : "Escalate"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

        </>
      )}

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Communication Module (In-app Notices)</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                select
                label="Target Type"
                value={noticeForm.target_type}
                onChange={(e) => setNoticeForm({ ...noticeForm, target_type: e.target.value })}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="class_section">Class + Section</MenuItem>
                <MenuItem value="student">Student</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Class"
                value={noticeForm.class_name}
                onChange={(e) => setNoticeForm({ ...noticeForm, class_name: e.target.value })}
                disabled={noticeForm.target_type === "all"}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Section"
                value={noticeForm.section}
                onChange={(e) => setNoticeForm({ ...noticeForm, section: e.target.value })}
                disabled={noticeForm.target_type === "all"}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Student Username"
                value={noticeForm.student_username}
                onChange={(e) => setNoticeForm({ ...noticeForm, student_username: e.target.value })}
                disabled={noticeForm.target_type !== "student"}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Title"
                value={noticeForm.title}
                onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Body"
                value={noticeForm.body}
                onChange={(e) => setNoticeForm({ ...noticeForm, body: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <Button variant="contained" onClick={createNotice} disabled={actionLoading}>
                Publish Notice
              </Button>
            </Grid>
          </Grid>

          <TableContainer component={Paper} sx={{ mt: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Created By</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {notices.slice(0, 10).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.created_at?.slice(0, 10) || "-"}</TableCell>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>
                      {item.target_type === "class_section"
                        ? `${item.class_name}-${item.section}`
                        : item.target_type === "student"
                          ? item.student_username
                          : "all"}
                    </TableCell>
                    <TableCell>{item.created_by}</TableCell>
                    <TableCell>
                      <Button size="small" color="error" variant="outlined" onClick={() => deleteNotice(item.id)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Button
        variant="contained"
        onClick={() => setAiOpen(true)}
        sx={{ position: "fixed", right: 24, bottom: 24, borderRadius: 999, zIndex: 1300 }}
      >
        botmitra
      </Button>

      {showTeachers && (
        <Grid container spacing={2} sx={{ mb: 4 }}>
          <Grid item xs={12} md={6}>
            <Card><CardContent><Typography variant="h6">Create Teacher</Typography>
              <Grid container spacing={2} mt={1}>
                <Grid item xs={12} md={6}><TextField fullWidth label="Username" value={newTeacher.username} onChange={(e) => setNewTeacher({ ...newTeacher, username: e.target.value })} /></Grid>
                <Grid item xs={12} md={6}><TextField fullWidth label="Password" type="password" value={newTeacher.password} onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })} /></Grid>
                <Grid item xs={12}><Button fullWidth variant="contained" onClick={createTeacher} disabled={actionLoading}>Create Teacher</Button></Grid>
              </Grid>
            </CardContent></Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card><CardContent><Typography variant="h6">Assign Class to Teacher</Typography>
              <Grid container spacing={2} mt={1}>
                <Grid item xs={12} md={4}><TextField fullWidth label="Teacher Username" value={assignData.username} onChange={(e) => setAssignData({ ...assignData, username: e.target.value })} /></Grid>
                <Grid item xs={12} md={4}><TextField fullWidth label="Class" value={assignData.class_name} onChange={(e) => setAssignData({ ...assignData, class_name: e.target.value })} /></Grid>
                <Grid item xs={12} md={4}><TextField fullWidth label="Section" value={assignData.section} onChange={(e) => setAssignData({ ...assignData, section: e.target.value })} /></Grid>
                <Grid item xs={12}><Button variant="contained" fullWidth onClick={assignClass} disabled={actionLoading}>Assign Class</Button></Grid>
              </Grid>
            </CardContent></Card>
          </Grid>
        </Grid>
      )}

      {showStudents && (
        <Card sx={{ mb: 4 }}>
          <CardContent><Typography variant="h6">Create Student</Typography>
            <Grid container spacing={2} mt={1}>
              <Grid item xs={12} md={3}><TextField fullWidth label="Username" value={newStudent.username} onChange={(e) => setNewStudent({ ...newStudent, username: e.target.value })} /></Grid>
              <Grid item xs={12} md={3}><TextField fullWidth label="Password" type="password" value={newStudent.password} onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })} /></Grid>
              <Grid item xs={12} md={2}><TextField fullWidth label="Roll No" value={newStudent.roll_no} onChange={(e) => setNewStudent({ ...newStudent, roll_no: e.target.value })} /></Grid>
              <Grid item xs={12} md={2}><TextField fullWidth label="Class" value={newStudent.class_name} onChange={(e) => setNewStudent({ ...newStudent, class_name: e.target.value })} /></Grid>
              <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={newStudent.section} onChange={(e) => setNewStudent({ ...newStudent, section: e.target.value })} /></Grid>
              <Grid item xs={12} md={8}><TextField fullWidth label="Name" value={newStudent.name} onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })} /></Grid>
              <Grid item xs={12} md={4}><Button fullWidth variant="contained" onClick={createStudent} disabled={actionLoading}>Create Student</Button></Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {showClasses && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Class-Section & Subject Master</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={3}><TextField fullWidth label="Class Name" value={classSectionForm.class_name} onChange={(e) => setClassSectionForm({ ...classSectionForm, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={classSectionForm.section} onChange={(e) => setClassSectionForm({ ...classSectionForm, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={3}><TextField fullWidth label="Program" value={classSectionForm.program} onChange={(e) => setClassSectionForm({ ...classSectionForm, program: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Semester" value={classSectionForm.semester} onChange={(e) => setClassSectionForm({ ...classSectionForm, semester: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><Button fullWidth variant="contained" onClick={createClassSection} disabled={actionLoading}>Save Section</Button></Grid>
          </Grid>

          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={2}><TextField fullWidth label="Class" value={subjectForm.class_name} onChange={(e) => setSubjectForm({ ...subjectForm, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={subjectForm.section} onChange={(e) => setSubjectForm({ ...subjectForm, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Subject Code" value={subjectForm.subject_code} onChange={(e) => setSubjectForm({ ...subjectForm, subject_code: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Subject Name" value={subjectForm.subject_name} onChange={(e) => setSubjectForm({ ...subjectForm, subject_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Type (theory/practical)" value={subjectForm.subject_type} onChange={(e) => setSubjectForm({ ...subjectForm, subject_type: e.target.value })} /></Grid>
            <Grid item xs={12} md={1}><TextField fullWidth label="Max" value={subjectForm.max_marks} onChange={(e) => setSubjectForm({ ...subjectForm, max_marks: e.target.value })} /></Grid>
            <Grid item xs={12} md={1}><Button fullWidth variant="contained" onClick={addSubject} disabled={actionLoading}>Add</Button></Grid>
          </Grid>
        </CardContent>
      </Card>
      )}

      {showClasses && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Timetable Management (Period-wise)</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={2}><TextField fullWidth label="Class" value={timetableForm.class_name} onChange={(e) => setTimetableForm({ ...timetableForm, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={timetableForm.section} onChange={(e) => setTimetableForm({ ...timetableForm, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Day (Monday...)" value={timetableForm.day_of_week} onChange={(e) => setTimetableForm({ ...timetableForm, day_of_week: e.target.value })} /></Grid>
            <Grid item xs={12} md={1}><TextField fullWidth label="Period" value={timetableForm.period_no} onChange={(e) => setTimetableForm({ ...timetableForm, period_no: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Start" placeholder="09:00" value={timetableForm.start_time} onChange={(e) => setTimetableForm({ ...timetableForm, start_time: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="End" placeholder="09:50" value={timetableForm.end_time} onChange={(e) => setTimetableForm({ ...timetableForm, end_time: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Subject Code" value={timetableForm.subject_code} onChange={(e) => setTimetableForm({ ...timetableForm, subject_code: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Teacher Username" value={timetableForm.teacher_username} onChange={(e) => setTimetableForm({ ...timetableForm, teacher_username: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><Button fullWidth variant="contained" onClick={saveTimetableEntry} disabled={actionLoading}>Save Slot</Button></Grid>
          </Grid>

          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={3}><TextField fullWidth label="Class Filter" value={timetableFilter.class_name} onChange={(e) => setTimetableFilter({ ...timetableFilter, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={3}><TextField fullWidth label="Section Filter" value={timetableFilter.section} onChange={(e) => setTimetableFilter({ ...timetableFilter, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={3}><TextField fullWidth label="Day Filter (optional)" value={timetableFilter.day_of_week} onChange={(e) => setTimetableFilter({ ...timetableFilter, day_of_week: e.target.value })} /></Grid>
            <Grid item xs={12} md={3}><Button fullWidth variant="outlined" onClick={loadTimetableEntries}>Load Timetable</Button></Grid>
          </Grid>

          {timetableEntries.length > 0 && (
            <TableContainer component={Paper} sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Class</TableCell>
                    <TableCell>Section</TableCell>
                    <TableCell>Day</TableCell>
                    <TableCell>Period</TableCell>
                    <TableCell>Time</TableCell>
                    <TableCell>Subject</TableCell>
                    <TableCell>Teacher</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {timetableEntries.map((row, index) => (
                    <TableRow key={`${row.class_name}-${row.section}-${row.day_of_week}-${row.period_no}-${index}`}>
                      <TableCell>{row.class_name}</TableCell>
                      <TableCell>{row.section}</TableCell>
                      <TableCell>{row.day_of_week}</TableCell>
                      <TableCell>{row.period_no}</TableCell>
                      <TableCell>{row.start_time || "--"} - {row.end_time || "--"}</TableCell>
                      <TableCell>{row.subject_code}</TableCell>
                      <TableCell>{row.teacher_username}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
      )}

      {showClasses && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Teacher Subject Assignment</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={3}><TextField fullWidth label="Teacher Username" value={subjectAssignForm.teacher_username} onChange={(e) => setSubjectAssignForm({ ...subjectAssignForm, teacher_username: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Class" value={subjectAssignForm.class_name} onChange={(e) => setSubjectAssignForm({ ...subjectAssignForm, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={subjectAssignForm.section} onChange={(e) => setSubjectAssignForm({ ...subjectAssignForm, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={3}><TextField fullWidth label="Subject Code" value={subjectAssignForm.subject_code} onChange={(e) => setSubjectAssignForm({ ...subjectAssignForm, subject_code: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><Button fullWidth variant="contained" onClick={assignSubjectTeacher} disabled={actionLoading}>Assign Subject</Button></Grid>
          </Grid>
        </CardContent>
      </Card>
      )}

      {showStudents && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Import Students (Google Sheet)</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={2}><TextField fullWidth label="Class" value={studentImportForm.class_name} onChange={(e) => setStudentImportForm({ ...studentImportForm, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={studentImportForm.section} onChange={(e) => setStudentImportForm({ ...studentImportForm, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={5}><TextField fullWidth label="Students Google Sheet URL (CSV export)" value={studentImportForm.sheet_url} onChange={(e) => setStudentImportForm({ ...studentImportForm, sheet_url: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Default Password" value={studentImportForm.default_password} onChange={(e) => setStudentImportForm({ ...studentImportForm, default_password: e.target.value })} /></Grid>
            <Grid item xs={12} md={1}><Button fullWidth variant="contained" onClick={importStudentsFromSheet} disabled={actionLoading}>Import</Button></Grid>
          </Grid>
        </CardContent>
      </Card>
      )}

      {showClasses && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Marks Sync Mapping (Teacher-Class)</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={3}><TextField fullWidth label="Teacher Username" value={sheetForm.teacher_username} onChange={(e) => setSheetForm({ ...sheetForm, teacher_username: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Class" value={sheetForm.class_name} onChange={(e) => setSheetForm({ ...sheetForm, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><TextField fullWidth label="Section" value={sheetForm.section} onChange={(e) => setSheetForm({ ...sheetForm, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={3}><TextField fullWidth label="Google Sheet URL" value={sheetForm.sheet_url} onChange={(e) => setSheetForm({ ...sheetForm, sheet_url: e.target.value })} /></Grid>
            <Grid item xs={12} md={2}><Button variant="contained" fullWidth onClick={saveSheetConfig} disabled={actionLoading}>Save Mapping</Button></Grid>
          </Grid>
        </CardContent>
      </Card>
      )}

      {showClasses && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Class Academic Overview (Subject-wise Graph)</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={4}><TextField fullWidth label="Class" value={overviewFilter.class_name} onChange={(e) => setOverviewFilter({ ...overviewFilter, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={4}><TextField fullWidth label="Section" value={overviewFilter.section} onChange={(e) => setOverviewFilter({ ...overviewFilter, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={4}><Button fullWidth variant="contained" onClick={loadClassOverview}>Load Overview</Button></Grid>
          </Grid>

          {classOverview && (
            <Box sx={{ mt: 3 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}><Card variant="outlined"><CardContent><Typography color="text.secondary">Students</Typography><Typography variant="h5">{classOverview.students_count}</Typography></CardContent></Card></Grid>
                <Grid item xs={12} md={4}><Card variant="outlined"><CardContent><Typography color="text.secondary">Subjects</Typography><Typography variant="h5">{classOverview.subjects_count}</Typography></CardContent></Card></Grid>
                <Grid item xs={12} md={4}><Card variant="outlined"><CardContent><Typography color="text.secondary">Subject Teachers</Typography><Typography variant="h5">{classOverview.assignments?.length || 0}</Typography></CardContent></Card></Grid>
              </Grid>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} md={6}><GraphBars title="Subject Avg % (from entered marks)" data={subjectPerformanceGraph} /></Grid>
                <Grid item xs={12} md={6}><GraphBars title="Subject Type Distribution" data={subjectTypeDistribution} /></Grid>
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>
      )}

      {showClasses && (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Class Grade Representation</Typography>
          <Grid container spacing={2} mt={1}>
            <Grid item xs={12} md={4}><TextField fullWidth label="Class" value={reportFilter.class_name} onChange={(e) => setReportFilter({ ...reportFilter, class_name: e.target.value })} /></Grid>
            <Grid item xs={12} md={4}><TextField fullWidth label="Section" value={reportFilter.section} onChange={(e) => setReportFilter({ ...reportFilter, section: e.target.value })} /></Grid>
            <Grid item xs={12} md={4}><Button fullWidth variant="contained" onClick={loadClassReport}>Load Grade Report</Button></Grid>
          </Grid>
          {classReport && (
            <Box sx={{ mt: 3 }}>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={4}><Card variant="outlined"><CardContent><Typography color="text.secondary">Students</Typography><Typography variant="h5">{classReport.student_count}</Typography></CardContent></Card></Grid>
                <Grid item xs={12} md={4}><Card variant="outlined"><CardContent><Typography color="text.secondary">Avg Weighted</Typography><Typography variant="h5">{averageWeightedScore}</Typography></CardContent></Card></Grid>
                <Grid item xs={12} md={4}><Card variant="outlined"><CardContent><Typography color="text.secondary">Grade A</Typography><Typography variant="h5">{gradeDistribution.find((i) => i.label === "A")?.value || 0}</Typography></CardContent></Card></Grid>
              </Grid>
              <GraphBars title="Grade Distribution" data={gradeDistribution} />
            </Box>
          )}
        </CardContent>
      </Card>
      )}

      {showClasses && (
        <>
          <Typography variant="h6" mb={2}>Subject Assignments</Typography>
          {subjectAssignments.length === 0 ? (
            <Typography color="text.secondary" sx={{ mb: 3 }}>No subject assignments found</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ mb: 4 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Teacher</TableCell>
                  <TableCell>Class</TableCell>
                  <TableCell>Section</TableCell>
                  <TableCell>Subject Code</TableCell>
                  <TableCell>Subject Name</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {subjectAssignments.map((item, idx) => (
                  <TableRow key={`${item.teacher_username}-${item.subject_code}-${idx}`}>
                    <TableCell>{item.teacher_username}</TableCell>
                    <TableCell>{item.class_name}</TableCell>
                    <TableCell>{item.section}</TableCell>
                    <TableCell>{item.subject_code}</TableCell>
                    <TableCell>{item.subject_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableContainer>
          )}
        </>
      )}

      {showTeachers && (
        <>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 2, flexWrap: "wrap" }}>
            <Typography variant="h6" sx={{ mr: "auto" }}>Teachers</Typography>
            <TextField size="small" label="Search teacher" value={teacherSearch} onChange={(e) => setTeacherSearch(e.target.value)} />
            <TextField size="small" label="Filter class" value={teacherClassFilter} onChange={(e) => setTeacherClassFilter(e.target.value)} />
            <TextField size="small" label="Filter section" value={teacherSectionFilter} onChange={(e) => setTeacherSectionFilter(e.target.value)} />
          </Box>
          {loading ? (
            <CircularProgress />
          ) : filteredTeachers.length === 0 ? (
            <Typography color="text.secondary">No teachers found</Typography>
          ) : (
            filteredTeachers.map((teacher, index) => (
              <Card key={`${teacher.username}-${index}`} sx={{ mb: 2 }}>
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Box>
                      <Typography>Username: <strong>{teacher.username}</strong></Typography>
                      <Typography>
                        Assigned Classes:
                        {teacher.assigned_classes && teacher.assigned_classes.length > 0
                          ? teacher.assigned_classes.map((item, i) => (
                              <Box key={`${item.class_name}-${item.section}-${i}`}>
                                - {item.class_name} {item.section}
                              </Box>
                            ))
                          : " None"}
                      </Typography>
                    </Box>
                    <Button color="error" variant="outlined" onClick={() => deleteUser(teacher.username)}>
                      Delete
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}

      {showStudents && (
        <>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 4, mb: 2, flexWrap: "wrap" }}>
            <Typography variant="h6" sx={{ mr: "auto" }}>Students</Typography>
            <TextField size="small" label="Search student" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
            <TextField size="small" label="Filter class" value={studentClassFilter} onChange={(e) => setStudentClassFilter(e.target.value)} />
            <TextField size="small" label="Filter section" value={studentSectionFilter} onChange={(e) => setStudentSectionFilter(e.target.value)} />
          </Box>
          {loading ? (
            <CircularProgress />
          ) : filteredStudents.length === 0 ? (
            <Typography color="text.secondary">No students found</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ mb: 4 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Username</TableCell>
                  <TableCell>Roll No</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Class</TableCell>
                  <TableCell>Section</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredStudents.map((student) => (
                  <TableRow key={student.username}>
                    <TableCell>{student.username}</TableCell>
                    <TableCell>{student.roll_no}</TableCell>
                    <TableCell>{student.name}</TableCell>
                <TableCell>{student.class_name}</TableCell>
                <TableCell>{student.section}</TableCell>
                <TableCell>
                  <Button variant="outlined" size="small" sx={{ mr: 1 }} onClick={() => openStudentSnapshot(student.username)}>
                    View
                  </Button>
                  <Button color="error" variant="outlined" size="small" onClick={() => deleteUser(student.username)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableContainer>
          )}
        </>
      )}

      <Dialog open={studentViewOpen} onClose={() => setStudentViewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Student Dashboard Snapshot</DialogTitle>
        <DialogContent dividers>
          {selectedStudentSnapshot ? (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <StatCard
                    label="Student"
                    value={`${selectedStudentSnapshot.student?.name || "-"} (${selectedStudentSnapshot.student?.username || "-"})`}
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Grade" value={selectedStudentSnapshot.overview?.grade || "-"} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Weighted Score" value={selectedStudentSnapshot.overview?.weighted_score || 0} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Attendance %" value={selectedStudentSnapshot.overview?.attendance_percentage || 0} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Avg Marks" value={selectedStudentSnapshot.overview?.average_marks || 0} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Assignment Avg" value={selectedStudentSnapshot.overview?.average_assignment_score || 0} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <StatCard label="Co-curricular Avg" value={selectedStudentSnapshot.overview?.average_co_curricular_score || 0} />
                </Grid>
              </Grid>

              <Typography variant="subtitle1" sx={{ mb: 1 }}>Recent Attendance</Typography>
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
                    {(selectedStudentSnapshot.attendance_history || []).map((row, idx) => (
                      <TableRow key={`${row.date}-${idx}`}>
                        <TableCell>{row.date}</TableCell>
                        <TableCell>{row.class_name}</TableCell>
                        <TableCell>{row.section}</TableCell>
                        <TableCell>{row.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : (
            <CircularProgress />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStudentViewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={aiOpen} onClose={() => setAiOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>botmitra AI Agent</DialogTitle>
        <DialogContent dividers>
          <Paper variant="outlined" sx={{ p: 2, mb: 2, height: 320, overflowY: "auto", bgcolor: "#f8fbff" }}>
            {aiChat.map((msg, idx) => (
              <Box
                key={`${msg.role}-${idx}`}
                sx={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", mb: 1 }}
              >
                <Box
                  sx={{
                    maxWidth: "82%",
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    bgcolor: msg.role === "user" ? "primary.main" : "#e8eef8",
                    color: msg.role === "user" ? "white" : "text.primary",
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                  }}
                >
                  {msg.text}
                </Box>
              </Box>
            ))}
            {aiLoading && (
              <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 1 }}>
                <Box
                  sx={{
                    maxWidth: "82%",
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    bgcolor: "#e8eef8",
                    color: "text.primary",
                    fontSize: 13,
                    fontStyle: "italic",
                  }}
                >
                  botmitra is typing...
                </Box>
              </Box>
            )}
            <Box ref={aiChatEndRef} />
          </Paper>

          <Grid container spacing={1.5}>
            <Grid item xs={12} md={10}>
              <TextField
                fullWidth
                label="Ask botmitra"
                placeholder="Show students with low attendance in MCA-B"
                value={aiForm.query}
                onChange={(e) => setAiForm({ ...aiForm, query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    runAiQuery();
                  }
                }}
              />
            </Grid>
            <Grid item xs={12} md={2} sx={{ display: "flex", gap: 1 }}>
              <Button fullWidth variant="contained" onClick={runAiQuery} disabled={aiLoading}>Send</Button>
              <Button fullWidth variant="outlined" onClick={runAiReport} disabled={aiLoading}>Report</Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default AdminDashboard;
