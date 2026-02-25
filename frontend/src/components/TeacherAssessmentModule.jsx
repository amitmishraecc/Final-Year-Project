import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { apiFetch } from "../lib/api";

const initialGenerateForm = {
  title: "",
  class_name: "",
  section: "",
  subject_code: "",
  topic: "",
  difficulty: "Medium",
  number_of_questions: 10,
  total_marks: 50,
};
const OPTION_LABELS = ["A", "B", "C", "D"];

function TeacherAssessmentModule({ classes = [], subjectAssignments = [] }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [assessments, setAssessments] = useState([]);
  const [generateForm, setGenerateForm] = useState(initialGenerateForm);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editQuestions, setEditQuestions] = useState([]);
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  const [attemptRows, setAttemptRows] = useState([]);

  const subjectOptions = useMemo(
    () =>
      subjectAssignments.filter(
        (item) => item.class_name === generateForm.class_name && item.section === generateForm.section
      ),
    [subjectAssignments, generateForm.class_name, generateForm.section]
  );

  const loadAssessments = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/assessments/teacher");
      setAssessments(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load assessments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssessments();
  }, []);

  useEffect(() => {
    if (generateForm.class_name || generateForm.section) return;
    if (!classes.length) return;
    const first = classes[0];
    const firstSubject =
      subjectAssignments.find(
        (item) => item.class_name === first.class_name && item.section === first.section
      )?.subject_code || "GENERAL";

    setGenerateForm((prev) => ({
      ...prev,
      class_name: first.class_name,
      section: first.section,
      subject_code: firstSubject,
    }));
  }, [classes, subjectAssignments, generateForm.class_name, generateForm.section]);

  const handleClassSectionChange = (value) => {
    const [className, section] = String(value || "").split("-");
    const subject =
      subjectAssignments.find((item) => item.class_name === className && item.section === section)?.subject_code ||
      "GENERAL";
    setGenerateForm((prev) => ({
      ...prev,
      class_name: className || "",
      section: section || "",
      subject_code: subject,
    }));
  };

  const generateAssessment = async () => {
    if (!generateForm.title.trim() || !generateForm.topic.trim()) {
      setError("Title and topic are required");
      return;
    }
    if (!generateForm.class_name || !generateForm.section || !generateForm.subject_code) {
      setError("Class, section and subject are required");
      return;
    }

    setSaving("generate");
    setMessage("");
    setError("");
    try {
      await apiFetch("/assessments/teacher/generate", {
        method: "POST",
        body: JSON.stringify({
          ...generateForm,
          title: generateForm.title.trim(),
          topic: generateForm.topic.trim(),
          subject_code: generateForm.subject_code.trim(),
          number_of_questions: Number(generateForm.number_of_questions || 0),
          total_marks: Number(generateForm.total_marks || 0),
        }),
      });
      setMessage("Assessment generated and saved as draft");
      setGenerateForm((prev) => ({ ...prev, title: "", topic: "" }));
      loadAssessments();
    } catch (err) {
      setError(err.message || "Failed to generate assessment");
    } finally {
      setSaving("");
    }
  };

  const openEdit = (assessment) => {
    setEditId(assessment.id);
    setEditTitle(assessment.title || "");
    setEditQuestions(
      (assessment.questions || []).map((q) => {
        const normalizedOptions = OPTION_LABELS.map((_, idx) =>
          String((Array.isArray(q.options) ? q.options[idx] : "") || "").trim()
        );
        const correctIdx = normalizedOptions.findIndex(
          (opt) => opt && String(opt).trim() === String(q.correct_answer || "").trim()
        );
        return {
          question_id: q.question_id || "",
          type: q.type || "mcq",
          question: q.question || "",
          options: normalizedOptions,
          correct_answer_option: correctIdx >= 0 ? OPTION_LABELS[correctIdx] : "",
          correct_answer: q.correct_answer || "",
          marks: Number(q.marks || 0),
        };
      })
    );
    setEditOpen(true);
  };

  const updateQuestion = (idx, key, value) => {
    setEditQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const addQuestion = () => {
    setEditQuestions((prev) => [
      ...prev,
      {
        question_id: `Q${prev.length + 1}`,
        type: "mcq",
        question: "",
        options: ["", "", "", ""],
        correct_answer_option: "A",
        correct_answer: "",
        marks: 1,
      },
    ]);
  };

  const removeQuestion = (index) => {
    setEditQuestions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const saveEdit = async () => {
    const payloadQuestions = [];
    for (let idx = 0; idx < editQuestions.length; idx += 1) {
      const q = editQuestions[idx];
      const base = {
        question_id: q.question_id || `Q${idx + 1}`,
        type: q.type,
        question: String(q.question || "").trim(),
        marks: Number(q.marks || 0),
      };

      if (q.type !== "mcq") {
        payloadQuestions.push({ ...base, options: [], correct_answer: null });
        continue;
      }

      const options = OPTION_LABELS.map((_, optIdx) => String((q.options || [])[optIdx] || "").trim());
      if (options.some((opt) => !opt)) {
        setError(`Question ${idx + 1}: all 4 options (A-D) are required.`);
        return;
      }
      if (new Set(options.map((opt) => opt.toLowerCase())).size !== 4) {
        setError(`Question ${idx + 1}: options must be unique.`);
        return;
      }
      const correctLabel = String(q.correct_answer_option || "").toUpperCase();
      const correctIndex = OPTION_LABELS.indexOf(correctLabel);
      if (correctIndex < 0) {
        setError(`Question ${idx + 1}: choose the correct option (A-D).`);
        return;
      }
      payloadQuestions.push({
        ...base,
        options,
        correct_answer: options[correctIndex],
      });
    }

    if (!editTitle.trim() || payloadQuestions.length === 0) {
      setError("Title and at least one question are required");
      return;
    }
    if (payloadQuestions.some((q) => !q.question || q.marks <= 0)) {
      setError("Each question needs text and marks > 0");
      return;
    }

    setSaving("edit");
    setError("");
    setMessage("");
    try {
      await apiFetch(`/assessments/teacher/${encodeURIComponent(editId)}`, {
        method: "PUT",
        body: JSON.stringify({ title: editTitle.trim(), questions: payloadQuestions }),
      });
      setMessage("Assessment updated");
      setEditOpen(false);
      loadAssessments();
    } catch (err) {
      setError(err.message || "Failed to update assessment");
    } finally {
      setSaving("");
    }
  };

  const updateStatus = async (assessmentId, action) => {
    setSaving(`${action}-${assessmentId}`);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/assessments/teacher/${encodeURIComponent(assessmentId)}/${action}`, { method: "POST" });
      setMessage(action === "publish" ? "Assessment published" : "Assessment locked");
      loadAssessments();
    } catch (err) {
      setError(err.message || `Failed to ${action} assessment`);
    } finally {
      setSaving("");
    }
  };

  const openAttempts = async (assessmentId) => {
    setSaving(`attempts-${assessmentId}`);
    setError("");
    try {
      const data = await apiFetch(`/assessments/teacher/${encodeURIComponent(assessmentId)}/attempts`);
      setAttemptRows(Array.isArray(data) ? data : []);
      setAttemptsOpen(true);
    } catch (err) {
      setError(err.message || "Failed to load attempts");
    } finally {
      setSaving("");
    }
  };

  const deleteAssessment = async (assessmentId, title) => {
    const ok = window.confirm(`Delete assessment "${title || "Untitled"}"? This cannot be undone.`);
    if (!ok) return;

    setSaving(`delete-${assessmentId}`);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/assessments/teacher/${encodeURIComponent(assessmentId)}`, { method: "DELETE" });
      setMessage("Assessment deleted");
      loadAssessments();
    } catch (err) {
      setError(err.message || "Failed to delete assessment");
    } finally {
      setSaving("");
    }
  };

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>AI Test Generator</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Assessment Title"
                value={generateForm.title}
                onChange={(e) => setGenerateForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                select
                label="Class-Section"
                value={`${generateForm.class_name}-${generateForm.section}`}
                onChange={(e) => handleClassSectionChange(e.target.value)}
              >
                {classes.map((cls) => {
                  const key = `${cls.class_name}-${cls.section}`;
                  return <MenuItem key={key} value={key}>{key}</MenuItem>;
                })}
              </TextField>
            </Grid>
            <Grid item xs={12} md={2}>
              {subjectOptions.length > 0 ? (
                <TextField
                  fullWidth
                  select
                  label="Subject"
                  value={generateForm.subject_code}
                  onChange={(e) => setGenerateForm((prev) => ({ ...prev, subject_code: e.target.value }))}
                >
                  {subjectOptions.map((s) => (
                    <MenuItem key={`${s.subject_code}-${s.class_name}-${s.section}`} value={s.subject_code}>
                      {s.subject_code}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  fullWidth
                  label="Subject"
                  value={generateForm.subject_code}
                  onChange={(e) => setGenerateForm((prev) => ({ ...prev, subject_code: e.target.value }))}
                />
              )}
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Topic"
                value={generateForm.topic}
                onChange={(e) => setGenerateForm((prev) => ({ ...prev, topic: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={1}>
              <TextField
                fullWidth
                select
                label="Level"
                value={generateForm.difficulty}
                onChange={(e) => setGenerateForm((prev) => ({ ...prev, difficulty: e.target.value }))}
              >
                <MenuItem value="Easy">Easy</MenuItem>
                <MenuItem value="Medium">Medium</MenuItem>
                <MenuItem value="Hard">Hard</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6} md={1}>
              <TextField
                fullWidth
                type="number"
                label="Questions"
                value={generateForm.number_of_questions}
                onChange={(e) =>
                  setGenerateForm((prev) => ({ ...prev, number_of_questions: Number(e.target.value || 0) }))
                }
                inputProps={{ min: 2, max: 100 }}
              />
            </Grid>
            <Grid item xs={6} md={1}>
              <TextField
                fullWidth
                type="number"
                label="Marks"
                value={generateForm.total_marks}
                onChange={(e) => setGenerateForm((prev) => ({ ...prev, total_marks: Number(e.target.value || 0) }))}
                inputProps={{ min: 1 }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <Button fullWidth variant="contained" onClick={generateAssessment} disabled={saving === "generate"}>
                {saving === "generate" ? "Generating..." : "Generate Test"}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Generated Assessments</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Class</TableCell>
                  <TableCell>Subject</TableCell>
                  <TableCell>Topic</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Questions</TableCell>
                  <TableCell>Total Marks</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(assessments || []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.title || "-"}</TableCell>
                    <TableCell>{row.class_name}-{row.section}</TableCell>
                    <TableCell>{row.subject_code || "-"}</TableCell>
                    <TableCell>{row.topic || "-"}</TableCell>
                    <TableCell>{row.status || "draft"}</TableCell>
                    <TableCell>{row.total_questions || 0}</TableCell>
                    <TableCell>{row.total_marks || 0}</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <Button size="small" variant="outlined" onClick={() => openEdit(row)} disabled={row.is_locked}>Edit</Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => updateStatus(row.id, "publish")}
                          disabled={row.is_locked || row.status === "published" || saving === `publish-${row.id}`}
                        >
                          Publish
                        </Button>
                        <Button
                          size="small"
                          color="warning"
                          variant="outlined"
                          onClick={() => updateStatus(row.id, "lock")}
                          disabled={row.is_locked || saving === `lock-${row.id}`}
                        >
                          Lock
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => openAttempts(row.id)}
                          disabled={saving === `attempts-${row.id}`}
                        >
                          Attempts
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={() => deleteAssessment(row.id, row.title)}
                          disabled={saving === `delete-${row.id}`}
                        >
                          Delete
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && assessments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>No assessments found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Edit Assessment</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            sx={{ mb: 2 }}
            label="Title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          {(editQuestions || []).map((q, idx) => (
            <Paper key={`${q.question_id}-${idx}`} variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Question {idx + 1}
              </Typography>
              <Grid container spacing={1}>
                <Grid item xs={12} md={1}>
                  <TextField
                    fullWidth
                    label="ID"
                    size="small"
                    value={q.question_id}
                    onChange={(e) => updateQuestion(idx, "question_id", e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={1.5}>
                  <TextField
                    fullWidth
                    select
                    label="Type"
                    size="small"
                    value={q.type}
                    onChange={(e) => updateQuestion(idx, "type", e.target.value)}
                  >
                    <MenuItem value="mcq">MCQ</MenuItem>
                    <MenuItem value="descriptive">Descriptive</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} md={7}>
                  <TextField
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                    label="Question"
                    value={q.question}
                    onChange={(e) => updateQuestion(idx, "question", e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} md={1}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Marks"
                    value={q.marks}
                    onChange={(e) => updateQuestion(idx, "marks", Number(e.target.value || 0))}
                    inputProps={{ min: 0.5, step: 0.5 }}
                  />
                </Grid>
                <Grid item xs={12} md={1.5}>
                  <Button fullWidth size="small" color="error" variant="outlined" onClick={() => removeQuestion(idx)}>
                    Remove
                  </Button>
                </Grid>
                {q.type === "mcq" && (
                  <>
                    {OPTION_LABELS.map((label, optIdx) => (
                      <Grid item xs={12} md={6} key={`${q.question_id || idx}-${label}`}>
                        <TextField
                          fullWidth
                          size="small"
                          label={`Option ${label}`}
                          value={(q.options || [])[optIdx] || ""}
                          onChange={(e) => {
                            const next = [...(q.options || ["", "", "", ""])];
                            next[optIdx] = e.target.value;
                            updateQuestion(idx, "options", next);
                          }}
                          sx={
                            q.correct_answer_option === label
                              ? { "& .MuiOutlinedInput-root": { backgroundColor: "#f3fff5" } }
                              : undefined
                          }
                        />
                      </Grid>
                    ))}
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        select
                        size="small"
                        label="Correct Option"
                        value={q.correct_answer_option || ""}
                        onChange={(e) => updateQuestion(idx, "correct_answer_option", e.target.value)}
                      >
                        {OPTION_LABELS.map((label) => (
                          <MenuItem key={`${q.question_id || idx}-correct-${label}`} value={label}>
                            {label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={8}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Correct Answer Preview"
                        value={
                          OPTION_LABELS.includes(String(q.correct_answer_option || ""))
                            ? ((q.options || [])[OPTION_LABELS.indexOf(String(q.correct_answer_option || ""))] || "")
                            : ""
                        }
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </Paper>
          ))}
          <Button variant="outlined" onClick={addQuestion}>Add Question</Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={saving === "edit"}>
            {saving === "edit" ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={attemptsOpen} onClose={() => setAttemptsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Assessment Attempts</DialogTitle>
        <DialogContent dividers>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Score %</TableCell>
                  <TableCell>Violations</TableCell>
                  <TableCell>Submitted At</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(attemptRows || []).map((row, idx) => (
                  <TableRow key={`${row.student_username}-${idx}`}>
                    <TableCell>{row.student_username || row.student_id || "-"}</TableCell>
                    <TableCell>{row.status || "-"}</TableCell>
                    <TableCell>{row.score_percentage ?? 0}</TableCell>
                    <TableCell>{row.tab_violations ?? 0}</TableCell>
                    <TableCell>{row.submitted_at?.slice(0, 19) || "-"}</TableCell>
                  </TableRow>
                ))}
                {attemptRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>No attempts yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAttemptsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default TeacherAssessmentModule;
