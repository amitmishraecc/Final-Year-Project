import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  TextField,
  Typography,
} from "@mui/material";
import { apiFetch } from "../lib/api";

function Attendance() {
  const { class_name, section } = useParams();
  const [students, setStudents] = useState([]);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchClassData = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const [studentsData, attendanceData, performanceData] = await Promise.all([
        apiFetch(`/teacher/students?class_name=${encodeURIComponent(class_name)}&section=${encodeURIComponent(section)}`),
        apiFetch(`/teacher/attendance?class_name=${encodeURIComponent(class_name)}&section=${encodeURIComponent(section)}&date=${encodeURIComponent(date)}`),
        apiFetch(`/performance/teacher/records?class_name=${encodeURIComponent(class_name)}&section=${encodeURIComponent(section)}&date=${encodeURIComponent(date)}`),
      ]);

      const attendanceMap = {};
      (attendanceData.records || []).forEach((rec) => {
        const id = String(rec.student_id || rec.roll_no || "");
        if (id) attendanceMap[id] = String(rec.status).toLowerCase() === "present";
      });

      const performanceMap = {};
      (Array.isArray(performanceData) ? performanceData : []).forEach((rec) => {
        performanceMap[String(rec.student_id)] = rec;
      });

      const merged = (Array.isArray(studentsData) ? studentsData : []).map((s) => {
        const studentId = String(s.student_id);
        const perf = performanceMap[studentId] || {};
        return {
          ...s,
          present: attendanceMap[studentId] ?? false,
          marks: perf.marks ?? "",
          assignment_score: perf.assignment_score ?? "",
          co_curricular_score: perf.co_curricular_score ?? "",
        };
      });
      setStudents(merged);
    } catch (err) {
      setError(err.message || "Failed to load class students");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClassData();
  }, [class_name, section, date]);

  const toggleAttendance = (index) => {
    setStudents((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], present: !next[index].present };
      return next;
    });
  };

  const updateField = (index, key, value) => {
    setStudents((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const submitAll = async () => {
    setSaving(true);
    try {
      const attendancePayload = {
        class_name,
        section,
        date,
        records: students.map((s) => ({
          student_id: String(s.student_id),
          status: s.present ? "Present" : "Absent",
        })),
      };

      const performancePayload = {
        class_name,
        section,
        date,
        records: students.map((s) => ({
          student_id: String(s.student_id),
          marks: Number(s.marks || 0),
          assignment_score: Number(s.assignment_score || 0),
          co_curricular_score: Number(s.co_curricular_score || 0),
        })),
      };

      await Promise.all([
        apiFetch("/teacher/attendance", {
          method: "POST",
          body: JSON.stringify(attendancePayload),
        }),
        apiFetch("/performance/teacher/records", {
          method: "POST",
          body: JSON.stringify(performancePayload),
        }),
      ]);

      setMessage("Attendance and performance saved");
    } catch (err) {
      setError(err.message || "Failed to save class tracker data");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container>
      <Typography variant="h5" mt={4} mb={2}>
        Class Tracker - {class_name}-{section}
      </Typography>

      <TextField
        type="date"
        label="Date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
        sx={{ mb: 2 }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
      <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Student ID</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Present</TableCell>
            <TableCell>Marks (0-100)</TableCell>
            <TableCell>Assignment (0-100)</TableCell>
            <TableCell>Co-Curricular (0-100)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {students.map((s, index) => (
            <TableRow key={`${s.student_id}-${index}`}>
              <TableCell>{s.student_id}</TableCell>
              <TableCell>{s.name}</TableCell>
              <TableCell>
                <Checkbox
                  checked={!!s.present}
                  onChange={() => toggleAttendance(index)}
                />
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 100 }}
                  value={s.marks}
                  onChange={(e) => updateField(index, "marks", e.target.value)}
                />
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 100 }}
                  value={s.assignment_score}
                  onChange={(e) =>
                    updateField(index, "assignment_score", e.target.value)
                  }
                />
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ min: 0, max: 100 }}
                  value={s.co_curricular_score}
                  onChange={(e) =>
                    updateField(index, "co_curricular_score", e.target.value)
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </TableContainer>
      )}

      <Box sx={{ mt: 3, mb: 4 }}>
        <Button variant="contained" onClick={submitAll} disabled={students.length === 0 || saving}>
          Save Tracker
        </Button>
      </Box>
    </Container>
  );
}

export default Attendance;
