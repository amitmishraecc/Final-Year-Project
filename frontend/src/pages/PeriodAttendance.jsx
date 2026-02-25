import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  MenuItem,
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

function PeriodAttendance() {
  const { class_name, section } = useParams();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [day, setDay] = useState("Monday");
  const [timetable, setTimetable] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedTimetable = useMemo(
    () => timetable.find((item) => String(item.period_no) === String(selectedSlot)),
    [timetable, selectedSlot]
  );

  useEffect(() => {
    const currentDay = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
    setDay(currentDay);
  }, [date]);

  const loadBaseData = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const [studentsData, timetableData] = await Promise.all([
        apiFetch(`/teacher/students?class_name=${encodeURIComponent(class_name)}&section=${encodeURIComponent(section)}`),
        apiFetch(`/academic/teacher/timetable?class_name=${encodeURIComponent(class_name)}&section=${encodeURIComponent(section)}&day_of_week=${encodeURIComponent(day)}`),
      ]);

      setStudents(
        (Array.isArray(studentsData) ? studentsData : []).map((student) => ({
          ...student,
          present: false,
        }))
      );
      setTimetable(Array.isArray(timetableData) ? timetableData : []);
      setSelectedSlot((prev) => {
        if (prev && (timetableData || []).some((t) => String(t.period_no) === String(prev))) {
          return prev;
        }
        return (timetableData || [])[0]?.period_no ? String((timetableData || [])[0].period_no) : "";
      });
    } catch (err) {
      setError(err.message || "Failed to load period attendance data");
    } finally {
      setLoading(false);
    }
  };

  const loadExistingAttendance = async () => {
    if (!selectedTimetable) return;
    try {
      const existing = await apiFetch(
        `/academic/teacher/period-attendance?class_name=${encodeURIComponent(class_name)}&section=${encodeURIComponent(
          section
        )}&subject_code=${encodeURIComponent(selectedTimetable.subject_code)}&period_no=${encodeURIComponent(
          selectedTimetable.period_no
        )}&date=${encodeURIComponent(date)}`
      );
      const map = {};
      (existing.records || []).forEach((record) => {
        map[String(record.student_id)] = String(record.status).toLowerCase() === "present";
      });
      setStudents((prev) =>
        prev.map((student) => ({
          ...student,
          present: !!map[String(student.student_id)],
        }))
      );
    } catch {
      // Keep default unchecked state if no existing attendance is found
    }
  };

  useEffect(() => {
    loadBaseData();
  }, [class_name, section, day]);

  useEffect(() => {
    loadExistingAttendance();
  }, [selectedSlot, date, timetable.length]);

  const toggleAttendance = (index) => {
    setStudents((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], present: !next[index].present };
      return next;
    });
  };

  const submitAttendance = async () => {
    if (!selectedTimetable) {
      setError("Please select a valid period from timetable");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/academic/teacher/period-attendance", {
        method: "POST",
        body: JSON.stringify({
          class_name,
          section,
          subject_code: selectedTimetable.subject_code,
          period_no: Number(selectedTimetable.period_no),
          date,
          records: students.map((student) => ({
            student_id: String(student.student_id),
            status: student.present ? "Present" : "Absent",
          })),
        }),
      });
      setMessage("Period attendance saved");
    } catch (err) {
      setError(err.message || "Failed to save period attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container>
      <Typography variant="h5" mt={4} mb={2}>
        Period-wise Attendance - {class_name}-{section}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <TextField
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField label="Day" value={day} InputProps={{ readOnly: true }} />
        <TextField
          select
          label="Period"
          value={selectedSlot}
          onChange={(e) => setSelectedSlot(e.target.value)}
          sx={{ minWidth: 260 }}
        >
          {timetable.map((slot) => (
            <MenuItem key={slot.period_no} value={String(slot.period_no)}>
              {`P${slot.period_no} - ${slot.subject_code} (${slot.start_time || "--"}-${slot.end_time || "--"})`}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {selectedTimetable && (
        <Typography color="text.secondary" sx={{ mb: 1.5 }}>
          Subject: {selectedTimetable.subject_code} | Teacher: {selectedTimetable.teacher_username}
        </Typography>
      )}
      {!loading && timetable.length === 0 && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          No timetable period found for {day}. Add timetable entries from Admin panel first.
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
              </TableRow>
            </TableHead>
            <TableBody>
              {students.map((student, index) => (
                <TableRow key={`${student.student_id}-${index}`}>
                  <TableCell>{student.student_id}</TableCell>
                  <TableCell>{student.name}</TableCell>
                  <TableCell>
                    <Checkbox checked={!!student.present} onChange={() => toggleAttendance(index)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box sx={{ mt: 2, mb: 4 }}>
        <Button variant="contained" onClick={submitAttendance} disabled={!selectedTimetable || saving || students.length === 0}>
          Save Period Attendance
        </Button>
      </Box>
    </Container>
  );
}

export default PeriodAttendance;
