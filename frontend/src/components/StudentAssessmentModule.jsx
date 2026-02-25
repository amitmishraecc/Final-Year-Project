import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  LinearProgress,
  Paper,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  FormControlLabel,
  RadioGroup,
} from "@mui/material";
import { apiFetch } from "../lib/api";

function StudentAssessmentModule() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [assessments, setAssessments] = useState([]);
  const [analytics, setAnalytics] = useState({
    subject_wise_performance: [],
    weak_topics: [],
    readiness_percentage: 0,
    gap_analysis: [],
    recommendations: [],
  });
  const [recommendationHistory, setRecommendationHistory] = useState([]);

  const [activeAssessment, setActiveAssessment] = useState(null);
  const [answers, setAnswers] = useState({});
  const [tabViolations, setTabViolations] = useState(0);
  const [submitResult, setSubmitResult] = useState(null);

  const lastViolationAtRef = useRef(0);

  const loadAssessments = async () => {
    const data = await apiFetch("/assessments/student");
    setAssessments(Array.isArray(data) ? data : []);
  };

  const loadAnalytics = async () => {
    const data = await apiFetch("/assessments/student/analytics/overview");
    setAnalytics(data || {});
  };

  const loadRecommendationHistory = async () => {
    const data = await apiFetch("/assessments/student/recommendations/history");
    setRecommendationHistory(Array.isArray(data) ? data : []);
  };

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadAssessments(), loadAnalytics(), loadRecommendationHistory()]);
    } catch (err) {
      setError(err.message || "Failed to load assessments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const reportViolation = async () => {
    if (!activeAssessment?.id) return;
    const now = Date.now();
    if (now - lastViolationAtRef.current < 3000) return;
    lastViolationAtRef.current = now;

    try {
      const data = await apiFetch(`/assessments/student/${encodeURIComponent(activeAssessment.id)}/tab-violation`, {
        method: "POST",
        body: JSON.stringify({ reason: "tab_switch_detected" }),
      });
      setTabViolations(Number(data?.tab_violations || 0));
      if (data?.auto_locked) {
        setMessage("Exam auto-locked due to tab switching violations.");
        setActiveAssessment(null);
        setAnswers({});
        loadAssessments();
      }
    } catch {
      // ignore transient errors to avoid blocking assessment UI
    }
  };

  useEffect(() => {
    if (!activeAssessment?.id) return undefined;

    const onVisibility = () => {
      if (document.hidden) {
        reportViolation();
      }
    };
    const onBlur = () => {
      reportViolation();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [activeAssessment?.id]);

  const startAttempt = async (assessmentId) => {
    setSaving(`start-${assessmentId}`);
    setError("");
    setMessage("");
    setSubmitResult(null);
    try {
      const startData = await apiFetch(`/assessments/student/${encodeURIComponent(assessmentId)}/start`, {
        method: "POST",
      });
      const questionData = await apiFetch(`/assessments/student/${encodeURIComponent(assessmentId)}`);
      setActiveAssessment(questionData || null);
      setAnswers({});
      setTabViolations(0);
      setMessage(startData?.message || "Assessment started");
    } catch (err) {
      setError(err.message || "Unable to start assessment");
    } finally {
      setSaving("");
    }
  };

  const submitAssessment = async () => {
    if (!activeAssessment?.id) return;
    setSaving("submit");
    setError("");
    setMessage("");
    try {
      const payload = {
        answers: Object.entries(answers).map(([question_id, response]) => ({ question_id, response })),
      };
      const data = await apiFetch(`/assessments/student/${encodeURIComponent(activeAssessment.id)}/submit`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSubmitResult(data || null);
      setMessage("Assessment submitted successfully");
      setActiveAssessment(null);
      setAnswers({});
      await Promise.all([loadAssessments(), loadAnalytics(), loadRecommendationHistory()]);
    } catch (err) {
      setError(err.message || "Failed to submit assessment");
    } finally {
      setSaving("");
    }
  };

  const subjectRows = useMemo(() => analytics?.subject_wise_performance || [], [analytics]);

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

      {loading ? (
        <LinearProgress sx={{ mb: 2 }} />
      ) : null}

      {activeAssessment ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{activeAssessment.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Topic: {activeAssessment.topic || "-"} | Difficulty: {activeAssessment.difficulty || "-"} | Total Marks: {activeAssessment.total_marks || 0}
            </Typography>
            <Alert severity={tabViolations >= 2 ? "error" : "warning"} sx={{ my: 2 }}>
              Tab switch violations: {tabViolations}/3. Exam auto-locks at 3.
            </Alert>

            {(activeAssessment.questions || []).map((q, idx) => (
              <Paper key={q.question_id || idx} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Q{idx + 1}. {q.question} ({q.marks} marks)
                </Typography>
                {q.type === "mcq" ? (
                  <RadioGroup
                    value={answers[q.question_id] || ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question_id]: e.target.value }))}
                  >
                    {(q.options || []).map((opt, optIdx) => (
                      <FormControlLabel key={`${q.question_id}-${optIdx}`} value={opt} control={<Radio />} label={opt} />
                    ))}
                  </RadioGroup>
                ) : (
                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    label="Write your answer"
                    value={answers[q.question_id] || ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question_id]: e.target.value }))}
                  />
                )}
              </Paper>
            ))}

            <Box sx={{ display: "flex", gap: 1 }}>
              <Button variant="contained" onClick={submitAssessment} disabled={saving === "submit"}>
                {saving === "submit" ? "Submitting..." : "Submit Assessment"}
              </Button>
              <Button variant="outlined" onClick={() => setActiveAssessment(null)}>
                Close
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1.5 }}>Available Assessments</Typography>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Topic</TableCell>
                    <TableCell>Subject</TableCell>
                    <TableCell>Difficulty</TableCell>
                    <TableCell>Questions</TableCell>
                    <TableCell>Marks</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(assessments || []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.title || "-"}</TableCell>
                      <TableCell>{row.topic || "-"}</TableCell>
                      <TableCell>{row.subject_code || "-"}</TableCell>
                      <TableCell>{row.difficulty || "-"}</TableCell>
                      <TableCell>{row.total_questions || 0}</TableCell>
                      <TableCell>{row.total_marks || 0}</TableCell>
                      <TableCell>{row.attempt_status || "not_started"}</TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => startAttempt(row.id)}
                          disabled={
                            ["submitted", "auto_locked", "locked"].includes(String(row.attempt_status || "")) ||
                            saving === `start-${row.id}`
                          }
                        >
                          {["submitted", "auto_locked", "locked"].includes(String(row.attempt_status || ""))
                            ? "Attempted"
                            : "Attempt"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {assessments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8}>No active assessments available.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {submitResult && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Score: {submitResult.score}/{submitResult.total_marks} ({submitResult.score_percentage}%)
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Industry Readiness Score</Typography>
              <Typography variant="h4">{analytics?.industry_readiness_score ?? 0}%</Typography>
              <LinearProgress
                variant="determinate"
                sx={{ mt: 1 }}
                value={Math.max(0, Math.min(100, Number(analytics?.industry_readiness_score || 0)))}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Gap Analysis</Typography>
              {(analytics?.gap_analysis || []).length ? (
                (analytics.gap_analysis || []).map((item, idx) => (
                  <Alert key={`${item}-${idx}`} severity="warning" sx={{ mb: 1 }}>{item}</Alert>
                ))
              ) : (
                <Alert severity="success">No major gap detected currently.</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Subject-wise Performance</Typography>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Subject</TableCell>
                      <TableCell>Percentage</TableCell>
                      <TableCell>Entries</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subjectRows.map((row) => (
                      <TableRow key={row.subject_code}>
                        <TableCell>{row.subject_code}</TableCell>
                        <TableCell>{row.percentage}%</TableCell>
                        <TableCell>{row.entries}</TableCell>
                      </TableRow>
                    ))}
                    {subjectRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3}>No subject performance records found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Weak Topics & Recommendations</Typography>
              <TableContainer component={Paper} sx={{ mb: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Topic</TableCell>
                      <TableCell>Avg Score</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(analytics?.weak_topics || []).map((row) => (
                      <TableRow key={row.topic}>
                        <TableCell>{row.topic}</TableCell>
                        <TableCell>{row.average_score}%</TableCell>
                      </TableRow>
                    ))}
                    {(analytics?.weak_topics || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2}>No weak topics detected.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: "grid", gap: 1 }}>
                {(analytics?.recommendations || []).map((rec, idx) => (
                  <Paper key={`${rec.topic}-${idx}`} variant="outlined" sx={{ p: 1.2 }}>
                    <Typography variant="subtitle2">{rec.topic}</Typography>
                    {(rec.resources || []).slice(0, 3).map((resource, ridx) => (
                      <Typography key={`${resource.url}-${ridx}`} variant="body2">
                        <a href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a>
                      </Typography>
                    ))}
                  </Paper>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Recommendation History</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Topic</TableCell>
                  <TableCell>Avg Score</TableCell>
                  <TableCell>Resources</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(recommendationHistory || []).map((row, idx) => (
                  <TableRow key={`${row.topic}-${idx}`}>
                    <TableCell>{row.created_at?.slice(0, 10) || "-"}</TableCell>
                    <TableCell>{row.topic || "-"}</TableCell>
                    <TableCell>{row.average_score ?? 0}%</TableCell>
                    <TableCell>{(row.resources || []).length}</TableCell>
                  </TableRow>
                ))}
                {recommendationHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>No recommendation history yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </>
  );
}

export default StudentAssessmentModule;
