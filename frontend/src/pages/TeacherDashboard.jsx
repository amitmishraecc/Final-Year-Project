import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Paper,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import StatCard from "../components/StatCard";
import TeacherAssessmentModule from "../components/TeacherAssessmentModule";
import RichAssignmentEditorDialog from "../components/RichAssignmentEditorDialog";
import RoleCalendarWidget from "../components/RoleCalendarWidget";
import {
  BotmitraDialog,
  StudentInsightsDialog,
  StudentProgressDialog,
  StudentsDialog,
} from "../components/teacher/TeacherDialogs";
import { apiFetch } from "../lib/api";
import { notifyNewItems, requestNotificationPermissionOnce } from "../lib/webNotify";

function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  const [sheetConfigs, setSheetConfigs] = useState([]);
  const [subjectAssignments, setSubjectAssignments] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncLoadingKey, setSyncLoadingKey] = useState("");
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState({ username: "", role: "", name: "" });
  const [studentsDialogOpen, setStudentsDialogOpen] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsSaving, setStudentsSaving] = useState("");
  const [selectedClass, setSelectedClass] = useState({ class_name: "", section: "" });
  const [studentsList, setStudentsList] = useState([]);
  const [notices, setNotices] = useState([]);
  const [noticeRosterMap, setNoticeRosterMap] = useState({});
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeForm, setNoticeForm] = useState({
    target_type: "class_section",
    class_name: "",
    section: "",
    student_username: "",
    title: "",
    body: "",
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiForm, setAiForm] = useState({ query: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const aiChatEndRef = useRef(null);
  const [aiChat, setAiChat] = useState([
    {
      role: "bot",
      text: "Hi, I am botmitra. Ask me for at-risk students, low attendance, or class summary.",
    },
  ]);
  const navigate = useNavigate();
  const aiChatStorageKey = `botmitra_chat_teacher_${profile.username || "default"}`;
  const [workboard, setWorkboard] = useState({
    pending_attendance_count: 0,
    pending_attendance: [],
    at_risk_count: 0,
    students_at_risk: [],
    open_interventions_count: 0,
  });
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [assignmentLoading, setAssignmentLoading] = useState("");
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [assignmentEditorOpen, setAssignmentEditorOpen] = useState(false);
  const [assignmentEditorDraft, setAssignmentEditorDraft] = useState("");
  const [assignmentOutcomesOpen, setAssignmentOutcomesOpen] = useState(false);
  const [selectedAssignmentMeta, setSelectedAssignmentMeta] = useState(null);
  const [assignmentOutcomeRows, setAssignmentOutcomeRows] = useState([]);
  const [studentInsightsOpen, setStudentInsightsOpen] = useState(false);
  const [studentInsightsMeta, setStudentInsightsMeta] = useState({ class_name: "", section: "" });
  const [studentInsightsRows, setStudentInsightsRows] = useState([]);
  const [studentProgressOpen, setStudentProgressOpen] = useState(false);
  const [studentProgressLoading, setStudentProgressLoading] = useState(false);
  const [studentProgressData, setStudentProgressData] = useState(null);
  const [pageView, setPageView] = useState("overview");
  const [assignmentStudents, setAssignmentStudents] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    class_name: "",
    section: "",
    subject_code: "",
    assignment_type: "personal",
    student_username: "",
    title: "",
    topic: "",
    question: "",
    content_html: "",
    due_date: "",
    max_marks: 100,
  });

  const stripHtml = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  const fetchClasses = async () => {
    setError("");
    setLoading(true);
    try {
      const [summaryData, configData, assignmentsData, noticesData, workboardData, teacherTasks] = await Promise.all([
        apiFetch("/teacher/class-summary"),
        apiFetch("/sheets/my-configs"),
        apiFetch("/academic/teacher/subject-assignments"),
        apiFetch("/notices/teacher"),
        apiFetch("/teacher/workboard"),
        apiFetch("/teacher/assignments"),
      ]);
      setClasses(Array.isArray(summaryData) ? summaryData : []);
      setSheetConfigs(Array.isArray(configData) ? configData : []);
      setSubjectAssignments(Array.isArray(assignmentsData) ? assignmentsData : []);
      setNotices(Array.isArray(noticesData) ? noticesData : []);
      setWorkboard(workboardData || {});
      setTeacherAssignments(Array.isArray(teacherTasks) ? teacherTasks : []);
      const classRows = Array.isArray(summaryData) ? summaryData : [];
      const rosterEntries = await Promise.all(
        classRows.map(async (row) => {
          const className = row.class_name;
          const section = row.section;
          const key = `${className}-${section}`;
          try {
            const students = await apiFetch(
              `/teacher/students?class_name=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`
            );
            return [key, Array.isArray(students) ? students : []];
          } catch {
            return [key, []];
          }
        })
      );
      setNoticeRosterMap(Object.fromEntries(rosterEntries));
      if (summaryData?.length && !noticeForm.class_name && !noticeForm.section) {
        setNoticeForm((prev) => ({
          ...prev,
          class_name: summaryData[0].class_name || "",
          section: summaryData[0].section || "",
        }));
      }
      const profileData = await apiFetch("/profile/me");
      setProfile(profileData || {});
    } catch (err) {
      setError(err.message || "Failed to load teacher dashboard");
    } finally {
      setLoading(false);
    }
  };

  const sheetConfigMap = useMemo(() => {
    const map = {};
    sheetConfigs.forEach((item) => {
      const key = `${item.class_name}-${item.section}`;
      map[key] = item;
    });
    return map;
  }, [sheetConfigs]);

  const subjectMap = useMemo(() => {
    const map = {};
    subjectAssignments.forEach((item) => {
      const key = `${item.class_name}-${item.section}`;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }, [subjectAssignments]);

  const summary = useMemo(() => {
    const linked = classes.filter((item) => sheetConfigMap[`${item.class_name}-${item.section}`]).length;
    return {
      classCount: classes.length,
      linkedSheets: linked,
      subjectCount: subjectAssignments.length,
    };
  }, [classes, sheetConfigMap, subjectAssignments]);

  const filteredClasses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((item) => `${item.class_name}-${item.section}`.toLowerCase().includes(q));
  }, [classes, search]);

  const calendarClassOptions = useMemo(
    () =>
      (classes || []).map((item) => ({
        class_name: item.class_name,
        section: item.section,
      })),
    [classes]
  );

  const noticeStudents = useMemo(() => {
    const key = `${noticeForm.class_name}-${noticeForm.section}`;
    return noticeRosterMap[key] || [];
  }, [noticeRosterMap, noticeForm.class_name, noticeForm.section]);

  const assignmentSubjects = useMemo(
    () =>
      (subjectAssignments || []).filter(
        (item) =>
          item.class_name === assignmentForm.class_name &&
          item.section === assignmentForm.section
      ),
    [subjectAssignments, assignmentForm.class_name, assignmentForm.section]
  );

  const activeAssignmentCount = useMemo(
    () => (teacherAssignments || []).filter((item) => item.status !== "completed").length,
    [teacherAssignments]
  );

  const assignmentStats = useMemo(() => {
    const rows = teacherAssignments || [];
    const total = rows.length;
    const common = rows.filter((r) => r.assignment_type === "common").length;
    const personal = rows.filter((r) => r.assignment_type === "personal").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    return {
      total,
      common,
      personal,
      completed,
      pending: Math.max(total - completed, 0),
    };
  }, [teacherAssignments]);

  const syncFromGoogleSheet = async (className, section) => {
    const key = `${className}-${section}`;
    setSyncLoadingKey(key);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch(
        `/sheets/teacher/sync?class_name=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`,
        { method: "POST" }
      );
      setMessage(`Synced ${data.rows_processed} rows for ${className}-${section} (${data.date})`);
      fetchClasses();
    } catch (err) {
      setError(err.message || "Sheet sync failed");
    } finally {
      setSyncLoadingKey("");
    }
  };

  const logout = () => {
    localStorage.clear();
    navigate("/");
  };

  const openStudentsDialog = async (className, section) => {
    setStudentsDialogOpen(true);
    setSelectedClass({ class_name: className, section });
    setStudentsLoading(true);
    setError("");
    try {
      const data = await apiFetch(
        `/teacher/students?class_name=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`
      );
      setStudentsList(
        (Array.isArray(data) ? data : []).map((student) => ({
          ...student,
          edited_name: student.name || "",
          edited_roll_no: student.roll_no || "",
        }))
      );
    } catch (err) {
      setError(err.message || "Failed to load students");
    } finally {
      setStudentsLoading(false);
    }
  };

  const updateStudentField = (index, key, value) => {
    setStudentsList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const saveStudentRecord = async (student) => {
    if (!student.username) return;
    setStudentsSaving(student.username);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/teacher/students/${encodeURIComponent(student.username)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: student.edited_name,
          roll_no: student.edited_roll_no,
        }),
      });
      setMessage(`Updated ${student.username}`);
      setStudentsList((prev) =>
        prev.map((item) =>
          item.username === student.username
            ? { ...item, name: item.edited_name, roll_no: item.edited_roll_no }
            : item
        )
      );
    } catch (err) {
      setError(err.message || "Failed to update student");
    } finally {
      setStudentsSaving("");
    }
  };

  const createClassNotice = async () => {
    if (!noticeForm.class_name || !noticeForm.section || !noticeForm.title || !noticeForm.body) {
      setError("Class, section, title and body are required for notice");
      return;
    }
    if (noticeForm.target_type === "student" && !noticeForm.student_username) {
      setError("Student username is required for individual notice");
      return;
    }
    setNoticeLoading(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/notices/teacher", {
        method: "POST",
        body: JSON.stringify({
          target_type: noticeForm.target_type,
          class_name: noticeForm.class_name,
          section: noticeForm.section,
          student_username:
            noticeForm.target_type === "student" ? noticeForm.student_username : undefined,
          title: noticeForm.title,
          body: noticeForm.body,
        }),
      });
      setMessage("Notice published");
      setNoticeForm((prev) => ({ ...prev, title: "", body: "", student_username: "" }));
      const noticesData = await apiFetch("/notices/teacher");
      setNotices(Array.isArray(noticesData) ? noticesData : []);
    } catch (err) {
      setError(err.message || "Failed to publish notice");
    } finally {
      setNoticeLoading(false);
    }
  };

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

  const openAssignmentDialog = async (student) => {
    const className = student?.class_name || "";
    const section = student?.section || "";
    const studentUsername = student?.username || "";
    const subjectForClass =
      (subjectAssignments || []).find(
        (item) => item.class_name === className && item.section === section
      )?.subject_code || "GENERAL";

    setAssignmentForm({
      class_name: className,
      section,
      subject_code: subjectForClass,
      assignment_type: "personal",
      student_username: studentUsername,
      title: "",
      topic: "",
      question: "",
      content_html: "",
      due_date: "",
      max_marks: 100,
    });
    setAssignmentDialogOpen(true);
    setAssignmentLoading(`load-${className}-${section}`);
    setError("");
    try {
      const students = await apiFetch(
        `/teacher/students?class_name=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`
      );
      setAssignmentStudents(Array.isArray(students) ? students : []);
    } catch {
      setAssignmentStudents([]);
    } finally {
      setAssignmentLoading("");
    }
  };

  const handleAssignmentClassSectionChange = async (value) => {
    const [className, section] = String(value || "").split("-");
    const defaultSubject =
      (subjectAssignments || []).find(
        (item) => item.class_name === className && item.section === section
      )?.subject_code || "GENERAL";
    setAssignmentForm((prev) => ({
      ...prev,
      class_name: className || "",
      section: section || "",
      subject_code: defaultSubject,
      student_username: "",
    }));
    if (!className || !section) {
      setAssignmentStudents([]);
      return;
    }
    try {
      const students = await apiFetch(
        `/teacher/students?class_name=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`
      );
      setAssignmentStudents(Array.isArray(students) ? students : []);
    } catch {
      setAssignmentStudents([]);
    }
  };

  const createTeacherAssignment = async () => {
    if (!assignmentForm.class_name || !assignmentForm.section || !assignmentForm.subject_code || !assignmentForm.title) {
      setError("Class, section, subject and title are required");
      return;
    }
    const htmlText = stripHtml(assignmentForm.content_html);
    if (!assignmentForm.topic.trim() && !assignmentForm.question.trim() && !htmlText) {
      setError("Add topic, short question, or rich content");
      return;
    }
    if (assignmentForm.assignment_type === "personal" && !assignmentForm.student_username) {
      setError("Please select a student for personal assignment");
      return;
    }
    if (!assignmentForm.due_date) {
      setError("Due date is required");
      return;
    }
    if (Number(assignmentForm.max_marks || 0) <= 0) {
      setError("Max marks must be greater than 0");
      return;
    }
    setAssignmentLoading("create");
    setError("");
    try {
      await apiFetch("/teacher/assignments", {
        method: "POST",
        body: JSON.stringify({
          class_name: assignmentForm.class_name,
          section: assignmentForm.section,
          subject_code: assignmentForm.subject_code,
          assignment_type: assignmentForm.assignment_type,
          student_username:
            assignmentForm.assignment_type === "personal"
              ? assignmentForm.student_username
              : undefined,
          title: assignmentForm.title.trim(),
          topic: assignmentForm.topic.trim(),
          question: assignmentForm.question.trim(),
          content_html: assignmentForm.content_html || "",
          due_date: assignmentForm.due_date || undefined,
          max_marks: Number(assignmentForm.max_marks || 100),
        }),
      });
      setMessage("Assignment created and assigned");
      setAssignmentDialogOpen(false);
      fetchClasses();
    } catch (err) {
      setError(err.message || "Failed to create assignment");
    } finally {
      setAssignmentLoading("");
    }
  };

  const openAssignmentEditor = () => {
    setAssignmentEditorDraft(assignmentForm.content_html || "");
    setAssignmentEditorOpen(true);
  };

  const saveAssignmentEditor = () => {
    setAssignmentForm((prev) => ({ ...prev, content_html: assignmentEditorDraft }));
    setAssignmentEditorOpen(false);
  };

  const updateAssignmentStatus = async (assignmentId, status) => {
    if (!assignmentId) return;
    setAssignmentLoading(`status-${assignmentId}`);
    setError("");
    try {
      await apiFetch(`/teacher/assignments/${encodeURIComponent(assignmentId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setMessage("Assignment status updated");
      fetchClasses();
    } catch (err) {
      setError(err.message || "Failed to update assignment status");
    } finally {
      setAssignmentLoading("");
    }
  };

  const openAssignmentOutcomes = async (assignment) => {
    if (!assignment?.id) return;
    setAssignmentLoading(`outcomes-${assignment.id}`);
    setError("");
    try {
      const data = await apiFetch(`/teacher/assignments/${encodeURIComponent(assignment.id)}/outcomes`);
      setSelectedAssignmentMeta({
        id: assignment.id,
        title: data?.title || assignment.title,
        assignment_type: data?.assignment_type || assignment.assignment_type,
        class_name: data?.class_name || assignment.class_name,
        section: data?.section || assignment.section,
        due_date: data?.due_date || assignment.due_date,
      });
      setAssignmentOutcomeRows(Array.isArray(data?.rows) ? data.rows : []);
      setAssignmentOutcomesOpen(true);
    } catch (err) {
      setError(err.message || "Failed to load assignment outcomes");
    } finally {
      setAssignmentLoading("");
    }
  };

  const updateOutcomeField = (idx, key, value) => {
    setAssignmentOutcomeRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const saveAssignmentOutcomes = async () => {
    if (!selectedAssignmentMeta?.id) return;
    setAssignmentLoading(`save-outcomes-${selectedAssignmentMeta.id}`);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/teacher/assignments/${encodeURIComponent(selectedAssignmentMeta.id)}/outcomes`, {
        method: "PUT",
        body: JSON.stringify({
          outcomes: assignmentOutcomeRows.map((row) => ({
            student_username: row.student_username,
            is_completed: Boolean(row.is_completed),
            completed_on_time: row.is_completed ? Boolean(row.completed_on_time) : null,
            grade_score:
              row.grade_score === "" || row.grade_score === null || row.grade_score === undefined
                ? null
                : Number(row.grade_score),
            feedback: row.feedback || "",
          })),
        }),
      });
      setMessage("Assignment evaluation saved");
      setAssignmentOutcomesOpen(false);
      fetchClasses();
    } catch (err) {
      setError(err.message || "Failed to save assignment evaluation");
    } finally {
      setAssignmentLoading("");
    }
  };

  const openStudentInsights = async (className, section) => {
    const key = `${className}-${section}`;
    setAssignmentLoading(`insights-${key}`);
    setError("");
    try {
      const data = await apiFetch(
        `/teacher/student-insights?class_name=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`
      );
      setStudentInsightsMeta({ class_name: className, section });
      setStudentInsightsRows(Array.isArray(data?.students) ? data.students : []);
      setStudentInsightsOpen(true);
    } catch (err) {
      setError(err.message || "Failed to load student insights");
    } finally {
      setAssignmentLoading("");
    }
  };

  const openStudentProgressAnalysis = async (studentUsername) => {
    if (!studentUsername || !studentInsightsMeta.class_name || !studentInsightsMeta.section) return;
    setStudentProgressLoading(true);
    setError("");
    try {
      const data = await apiFetch(
        `/teacher/student-progress-analysis?class_name=${encodeURIComponent(
          studentInsightsMeta.class_name
        )}&section=${encodeURIComponent(studentInsightsMeta.section)}&student_username=${encodeURIComponent(studentUsername)}`
      );
      setStudentProgressData(data || null);
      setStudentProgressOpen(true);
    } catch (err) {
      setError(err.message || "Failed to load student progress analysis");
    } finally {
      setStudentProgressLoading(false);
    }
  };

  const runAssignmentReminders = async () => {
    setAssignmentLoading("reminders");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch("/teacher/assignments/send-reminders", {
        method: "POST",
        body: JSON.stringify({ days_before_due: 1 }),
      });
      setMessage(
        `Reminder job completed. Sent: ${data?.sent ?? 0}, Skipped: ${data?.skipped ?? 0}, Failed: ${data?.failed ?? 0}`
      );
    } catch (err) {
      setError(err.message || "Failed to run reminder emails");
    } finally {
      setAssignmentLoading("");
    }
  };

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

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    if (!profile.username) return;
    requestNotificationPermissionOnce(`web_notify_prompted_teacher_${profile.username}`);
  }, [profile.username]);

  useEffect(() => {
    if (!profile.username || !Array.isArray(notices)) return;
    notifyNewItems({
      items: notices,
      storageKey: `web_notify_seen_teacher_${profile.username}`,
      title: "botmitra Notice",
      getBody: (item) => `${item?.title || "Notice"}: ${item?.body || ""}`.slice(0, 180),
    });
  }, [notices, profile.username]);

  useEffect(() => {
    if (!profile.username) return;
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
  }, [profile.username, aiChatStorageKey]);

  useEffect(() => {
    if (!profile.username) return;
    localStorage.setItem(aiChatStorageKey, JSON.stringify(aiChat));
  }, [aiChat, profile.username, aiChatStorageKey]);

  useEffect(() => {
    if (!aiOpen) return;
    aiChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiChat, aiLoading, aiOpen]);

  useEffect(() => {
    if (assignmentForm.class_name || assignmentForm.section) return;
    if (!classes.length) return;
    const first = classes[0];
    if (!first?.class_name || !first?.section) return;
    handleAssignmentClassSectionChange(`${first.class_name}-${first.section}`);
  }, [classes]);

  return (
    <Container>
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, mb: 2 }}>
        <Typography variant="h4">Teacher Dashboard</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="body1">{profile.name || profile.username || "Teacher"}</Typography>
          <Button variant="outlined" onClick={logout}>
            Logout
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Button variant={pageView === "overview" ? "contained" : "outlined"} onClick={() => setPageView("overview")}>Overview</Button>
        <Button variant={pageView === "classes" ? "contained" : "outlined"} onClick={() => setPageView("classes")}>Classes</Button>
        <Button variant={pageView === "assignments" ? "contained" : "outlined"} onClick={() => setPageView("assignments")}>Assignments</Button>
        <Button variant={pageView === "assessments" ? "contained" : "outlined"} onClick={() => setPageView("assessments")}>AI Assessments</Button>
        <Button variant={pageView === "communication" ? "contained" : "outlined"} onClick={() => setPageView("communication")}>Communication</Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={4}><StatCard label="Assigned Classes" value={summary.classCount} /></Grid>
        <Grid item xs={12} md={4}><StatCard label="Assigned Subjects" value={summary.subjectCount} /></Grid>
        <Grid item xs={12} md={4}><StatCard label="Linked Google Sheets" value={summary.linkedSheets} /></Grid>
      </Grid>

      {pageView === "overview" && (
        <>
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1.5 }}>Teacher Workboard</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}><StatCard label="Pending Attendance (Today)" value={workboard.pending_attendance_count || 0} /></Grid>
              <Grid item xs={12} md={4}><StatCard label="At-Risk Students" value={workboard.at_risk_count || 0} accent="error.main" /></Grid>
              <Grid item xs={12} md={4}><StatCard label="Active Assignments" value={activeAssignmentCount} /></Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>At-Risk Students (Top)</Typography>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Class</TableCell>
                        <TableCell>Risk</TableCell>
                        <TableCell>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(workboard.students_at_risk || []).slice(0, 8).map((s) => {
                        const key = `${s.class_name}-${s.section}`;
                        const loadingKey = assignmentLoading === `load-${key}`;
                        return (
                          <TableRow key={`${s.username}-${key}`}>
                            <TableCell>{s.name}</TableCell>
                            <TableCell>{s.class_name}-{s.section}</TableCell>
                            <TableCell>{s.severity}</TableCell>
                            <TableCell>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={loadingKey}
                                onClick={() => openAssignmentDialog(s)}
                              >
                                {loadingKey ? "Working..." : "Assign Task"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Assignment Evaluation Workflow</Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Use the <strong>Assignments</strong> tab to manage latest assigned tasks,
                    mark individual student completion, on-time submission status, grading, and NLP feedback analysis.
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
        <RoleCalendarWidget role="teacher" classOptions={calendarClassOptions} />
        </>
      )}

      {pageView === "assignments" && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1.5 }}>Assignment Center</Typography>
            <Grid container spacing={2} sx={{ mb: 1 }}>
              <Grid item xs={6} md={2}><StatCard label="Total" value={assignmentStats.total} /></Grid>
              <Grid item xs={6} md={2}><StatCard label="Classroom" value={assignmentStats.common} /></Grid>
              <Grid item xs={6} md={2}><StatCard label="Individual" value={assignmentStats.personal} /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Completed" value={assignmentStats.completed} accent="success.main" /></Grid>
              <Grid item xs={12} md={3}><StatCard label="Pending" value={assignmentStats.pending} accent="warning.main" /></Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  select
                  label="Class-Section"
                  value={`${assignmentForm.class_name}-${assignmentForm.section}`}
                  onChange={(e) => handleAssignmentClassSectionChange(e.target.value)}
                >
                  {classes.map((cls) => {
                    const key = `${cls.class_name}-${cls.section}`;
                    return <MenuItem key={key} value={key}>{key}</MenuItem>;
                  })}
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth
                  select
                  label="Type"
                  value={assignmentForm.assignment_type}
                  onChange={(e) =>
                    setAssignmentForm((prev) => ({
                      ...prev,
                      assignment_type: e.target.value,
                      student_username: e.target.value === "personal" ? prev.student_username : "",
                    }))
                  }
                >
                  <MenuItem value="common">Entire Classroom</MenuItem>
                  <MenuItem value="personal">Individual</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth
                  label="Subject Code"
                  value={assignmentForm.subject_code}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, subject_code: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  select
                  label="Student"
                  value={assignmentForm.student_username}
                  disabled={assignmentForm.assignment_type !== "personal"}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, student_username: e.target.value }))}
                >
                  {assignmentStudents.map((student) => (
                    <MenuItem key={student.username} value={student.username}>
                      {student.username} ({student.name || "Student"})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth
                  type="date"
                  label="Due Date"
                  value={assignmentForm.due_date}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, due_date: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Title"
                  value={assignmentForm.title}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Topic"
                  value={assignmentForm.topic}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, topic: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Question / Task"
                  value={assignmentForm.question}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, question: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth
                  type="number"
                  label="Max Marks"
                  value={assignmentForm.max_marks}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, max_marks: e.target.value }))}
                  inputProps={{ min: 1 }}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <Button fullWidth variant="outlined" onClick={openAssignmentEditor}>
                  Open Rich Editor
                </Button>
              </Grid>
              <Grid item xs={12} md={8}>
                <TextField
                  fullWidth
                  label="Rich Content Preview"
                  value={stripHtml(assignmentForm.content_html).slice(0, 220)}
                  placeholder="No rich content added yet"
                  InputProps={{ readOnly: true }}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <Button fullWidth variant="contained" onClick={createTeacherAssignment} disabled={assignmentLoading === "create"}>
                  {assignmentLoading === "create" ? "Assigning..." : "Assign"}
                </Button>
              </Grid>
            </Grid>

            <Box sx={{ mt: 2, mb: 1, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
              <Typography variant="subtitle2">Assigned Tasks</Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={runAssignmentReminders}
                disabled={assignmentLoading === "reminders"}
              >
                {assignmentLoading === "reminders" ? "Sending..." : "Send Reminder Emails"}
              </Button>
            </Box>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Subject</TableCell>
                    <TableCell>Class</TableCell>
                    <TableCell>Due Date</TableCell>
                    <TableCell>Progress</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(teacherAssignments || []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.title || "-"}</TableCell>
                      <TableCell>{row.assignment_type === "personal" ? row.target_username || "-" : "Common"}</TableCell>
                      <TableCell>{row.subject_code || "-"}</TableCell>
                      <TableCell>{row.class_name}-{row.section}</TableCell>
                      <TableCell>{row.due_date || "-"}</TableCell>
                      <TableCell>
                        {row.assignment_type === "common"
                          ? `Submitted ${row?.submission_summary?.submitted ?? 0}, Late ${row?.submission_summary?.late ?? 0}, Missing ${row?.submission_summary?.missing ?? 0}`
                          : row.status === "completed"
                            ? "Submitted"
                            : "Missing"}
                      </TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openAssignmentOutcomes(row)}
                            disabled={assignmentLoading === `outcomes-${row.id}`}
                          >
                            Evaluate
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={assignmentLoading === `status-${row.id}`}
                            onClick={() =>
                              updateAssignmentStatus(
                                row.id,
                                row.status === "completed" ? "assigned" : "completed"
                              )
                            }
                          >
                            {row.status === "completed" ? "Reopen" : "Mark Complete"}
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && (teacherAssignments || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8}>No assignments created yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}


      {pageView === "assessments" && (
        <TeacherAssessmentModule classes={classes} subjectAssignments={subjectAssignments} />
      )}
      {pageView === "communication" && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Communication Module (Teacher Notices)</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                select
                label="Target Type"
                value={noticeForm.target_type}
                onChange={(e) =>
                  setNoticeForm((prev) => ({
                    ...prev,
                    target_type: e.target.value,
                    student_username: "",
                  }))
                }
              >
                <MenuItem value="class_section">Class + Section</MenuItem>
                <MenuItem value="student">Individual Student</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                select
                label="Class-Section"
                value={`${noticeForm.class_name}-${noticeForm.section}`}
                onChange={(e) => {
                  const [className, section] = String(e.target.value || "").split("-");
                  setNoticeForm((prev) => ({
                    ...prev,
                    class_name: className || "",
                    section: section || "",
                    student_username: "",
                  }));
                }}
              >
                {classes.map((cls) => {
                  const key = `${cls.class_name}-${cls.section}`;
                  return <MenuItem key={key} value={key}>{key}</MenuItem>;
                })}
              </TextField>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                select
                label="Student Username"
                value={noticeForm.student_username}
                onChange={(e) => setNoticeForm((prev) => ({ ...prev, student_username: e.target.value }))}
                disabled={noticeForm.target_type !== "student"}
              >
                {noticeStudents.map((student) => (
                  <MenuItem key={student.username || student.student_id} value={student.username || ""}>
                    {(student.username || "-")} ({student.name || "Student"})
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Title"
                value={noticeForm.title}
                onChange={(e) => setNoticeForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Notice Body"
                value={noticeForm.body}
                onChange={(e) => setNoticeForm((prev) => ({ ...prev, body: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <Button fullWidth variant="contained" onClick={createClassNotice} disabled={noticeLoading}>
                {noticeLoading ? "Publishing..." : "Publish"}
              </Button>
            </Grid>
          </Grid>

            <TableContainer component={Paper} sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Body</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {notices.slice(0, 8).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.created_at?.slice(0, 10) || "-"}</TableCell>
                      <TableCell>
                        {item.target_type === "student"
                          ? `${item.student_username} (${item.class_name}-${item.section})`
                          : item.target_type === "class_section"
                          ? `${item.class_name}-${item.section}`
                          : item.target_type}
                      </TableCell>
                      <TableCell>{item.title}</TableCell>
                      <TableCell>{item.body}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {pageView === "classes" && (
        <TextField
          fullWidth
          label="Search by class-section"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 2 }}
        />
      )}

      {pageView === "classes" && (loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {filteredClasses.map((item, index) => {
            const key = `${item.class_name}-${item.section}`;
            const config = sheetConfigMap[key];
            const syncing = syncLoadingKey === key;
            return (
              <Grid item xs={12} md={6} lg={4} key={`${key}-${index}`}>
                <Card sx={{ height: "100%" }}>
                  <CardContent>
                    <Typography variant="h6">
                      Class {item.class_name}-{item.section}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                      Students: {item.students_count ?? 0}
                    </Typography>
                    <Typography color="text.secondary">
                      Last Attendance: {item.last_attendance_date || "Not marked"}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                      Subjects:
                      {(subjectMap[key] || []).length > 0
                        ? ` ${(subjectMap[key] || []).map((s) => s.subject_code).join(", ")}`
                        : " None assigned"}
                    </Typography>

                    <Box sx={{ mt: 1.5 }}>
                      {config ? (
                        <Chip label="Google Sheet Linked" color="success" size="small" />
                      ) : (
                        <Chip label="No Sheet Linked" color="warning" size="small" />
                      )}
                    </Box>

                    <Box sx={{ mt: 2, display: "flex", gap: 1, flexWrap: "wrap" }}>
                    <Button
                      variant="outlined"
                      onClick={() => navigate(`/teacher/period-attendance/${item.class_name}/${item.section}`)}
                    >
                      Period Attendance
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => openStudentInsights(item.class_name, item.section)}
                      disabled={assignmentLoading === `insights-${item.class_name}-${item.section}`}
                    >
                      Student Insights
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => openStudentsDialog(item.class_name, item.section)}
                    >
                      View Students
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={!config || syncing}
                        onClick={() => syncFromGoogleSheet(item.class_name, item.section)}
                      >
                        {syncing ? "Syncing..." : "Sync Sheet"}
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      ))}

      {pageView === "classes" && !loading && !error && filteredClasses.length === 0 && (
        <Typography sx={{ mt: 3 }} color="text.secondary">
          No matching classes found.
        </Typography>
      )}

      <Button
        variant="contained"
        onClick={() => setAiOpen(true)}
        sx={{ position: "fixed", right: 24, bottom: 24, borderRadius: 999, zIndex: 1300 }}
      >
        botmitra
      </Button>

      <BotmitraDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        aiChat={aiChat}
        aiLoading={aiLoading}
        aiFormQuery={aiForm.query}
        onChangeQuery={(value) => setAiForm((prev) => ({ ...prev, query: value }))}
        onSend={runAiQuery}
        onReport={runAiReport}
        chatEndRef={aiChatEndRef}
      />

      <Dialog open={assignmentOutcomesOpen} onClose={() => setAssignmentOutcomesOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          Evaluate Assignment - {selectedAssignmentMeta?.title || "-"}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {selectedAssignmentMeta?.class_name}-{selectedAssignmentMeta?.section} | Type: {selectedAssignmentMeta?.assignment_type} | Due: {selectedAssignmentMeta?.due_date || "-"}
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell>Completed</TableCell>
                  <TableCell>On Time</TableCell>
                  <TableCell>Grade (0-100)</TableCell>
                  <TableCell>Feedback</TableCell>
                  <TableCell>NLP Insight</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(assignmentOutcomeRows || []).map((row, idx) => (
                  <TableRow key={`${row.student_username}-${idx}`}>
                    <TableCell>{row.student_username}</TableCell>
                    <TableCell>
                      <Checkbox
                        checked={Boolean(row.is_completed)}
                        onChange={(e) => updateOutcomeField(idx, "is_completed", e.target.checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={Boolean(row.completed_on_time)}
                        disabled={!row.is_completed}
                        onChange={(e) => updateOutcomeField(idx, "completed_on_time", e.target.checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={row.grade_score ?? ""}
                        onChange={(e) => updateOutcomeField(idx, "grade_score", e.target.value)}
                        inputProps={{ min: 0, max: 100 }}
                        sx={{ width: 110 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        multiline
                        minRows={2}
                        value={row.feedback || ""}
                        onChange={(e) => updateOutcomeField(idx, "feedback", e.target.value)}
                        sx={{ minWidth: 280 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ display: "block" }}>
                        Sentiment: {row?.nlp_analysis?.sentiment || "-"}
                      </Typography>
                      <Typography variant="caption" sx={{ display: "block" }}>
                        Risks: {(row?.nlp_analysis?.risk_flags || []).join(", ") || "-"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignmentOutcomesOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={saveAssignmentOutcomes}
            disabled={!selectedAssignmentMeta?.id || assignmentLoading === `save-outcomes-${selectedAssignmentMeta?.id}`}
          >
            Save Evaluation
          </Button>
        </DialogActions>
      </Dialog>

      <StudentInsightsDialog
        open={studentInsightsOpen}
        onClose={() => setStudentInsightsOpen(false)}
        meta={studentInsightsMeta}
        rows={studentInsightsRows}
        onDeepAnalysis={openStudentProgressAnalysis}
        studentProgressLoading={studentProgressLoading}
      />

      <StudentProgressDialog
        open={studentProgressOpen}
        onClose={() => setStudentProgressOpen(false)}
        loading={studentProgressLoading}
        data={studentProgressData}
      />

      <Dialog open={assignmentDialogOpen} onClose={() => setAssignmentDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Assignment Task</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <TextField fullWidth label="Class" value={assignmentForm.class_name} disabled />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField fullWidth label="Section" value={assignmentForm.section} disabled />
            </Grid>
            <Grid item xs={12} md={3}>
              {assignmentSubjects.length > 0 ? (
                <TextField
                  fullWidth
                  select
                  label="Subject"
                  value={assignmentForm.subject_code}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, subject_code: e.target.value }))}
                >
                  {assignmentSubjects.map((item) => (
                    <MenuItem key={`${item.subject_code}-${item.class_name}-${item.section}`} value={item.subject_code}>
                      {item.subject_code}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  fullWidth
                  label="Subject Code"
                  value={assignmentForm.subject_code}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, subject_code: e.target.value }))}
                  helperText="No mapped subject found. You can enter manually."
                />
              )}
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                select
                label="Type"
                value={assignmentForm.assignment_type}
                onChange={(e) =>
                  setAssignmentForm((prev) => ({
                    ...prev,
                    assignment_type: e.target.value,
                    student_username: e.target.value === "personal" ? prev.student_username : "",
                  }))
                }
              >
                <MenuItem value="personal">Personal</MenuItem>
                <MenuItem value="common">Common</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="date"
                label="Due Date"
                value={assignmentForm.due_date}
                onChange={(e) => setAssignmentForm((prev) => ({ ...prev, due_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                select
                label="Student"
                value={assignmentForm.student_username}
                disabled={assignmentForm.assignment_type !== "personal"}
                onChange={(e) => setAssignmentForm((prev) => ({ ...prev, student_username: e.target.value }))}
              >
                {assignmentStudents.map((student) => (
                  <MenuItem key={student.username} value={student.username}>
                    {student.username} ({student.name || "Student"})
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={8}>
              <TextField
                fullWidth
                label="Title"
                value={assignmentForm.title}
                onChange={(e) => setAssignmentForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Topic"
                value={assignmentForm.topic}
                onChange={(e) => setAssignmentForm((prev) => ({ ...prev, topic: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Question / Task"
                value={assignmentForm.question}
                onChange={(e) => setAssignmentForm((prev) => ({ ...prev, question: e.target.value }))}
              />
            </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  type="number"
                  label="Max Marks"
                value={assignmentForm.max_marks}
                onChange={(e) => setAssignmentForm((prev) => ({ ...prev, max_marks: e.target.value }))}
                inputProps={{ min: 1 }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <Button fullWidth variant="outlined" onClick={openAssignmentEditor}>
                Open Rich Editor
              </Button>
            </Grid>
            <Grid item xs={12} md={9}>
              <TextField
                fullWidth
                label="Rich Content Preview"
                value={stripHtml(assignmentForm.content_html).slice(0, 220)}
                placeholder="No rich content added yet"
                InputProps={{ readOnly: true }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignmentDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={createTeacherAssignment} disabled={assignmentLoading === "create"}>
            {assignmentLoading === "create" ? "Assigning..." : "Assign Task"}
          </Button>
        </DialogActions>
      </Dialog>

      <RichAssignmentEditorDialog
        open={assignmentEditorOpen}
        value={assignmentEditorDraft}
        onChange={setAssignmentEditorDraft}
        onClose={() => setAssignmentEditorOpen(false)}
        onSave={saveAssignmentEditor}
      />

      <StudentsDialog
        open={studentsDialogOpen}
        onClose={() => setStudentsDialogOpen(false)}
        selectedClass={selectedClass}
        studentsLoading={studentsLoading}
        studentsList={studentsList}
        studentsSaving={studentsSaving}
        onChangeField={updateStudentField}
        onSaveStudent={saveStudentRecord}
      />
    </Container>
  );
}

export default TeacherDashboard;

