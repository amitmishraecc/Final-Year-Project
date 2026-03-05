import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
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
import StatCard from "../StatCard";

export function BotmitraDialog({
  open,
  onClose,
  aiChat,
  aiLoading,
  aiFormQuery,
  onChangeQuery,
  onSend,
  onReport,
  chatEndRef,
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
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
          <Box ref={chatEndRef} />
        </Paper>

        <Grid container spacing={1.5}>
          <Grid item xs={12} md={10}>
            <TextField
              fullWidth
              label="Ask botmitra"
              placeholder="Show students with low attendance in MCA-B"
              value={aiFormQuery}
              onChange={(e) => onChangeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
            />
          </Grid>
          <Grid item xs={12} md={2} sx={{ display: "flex", gap: 1 }}>
            <Button fullWidth variant="contained" onClick={onSend} disabled={aiLoading}>Send</Button>
            <Button fullWidth variant="outlined" onClick={onReport} disabled={aiLoading}>Report</Button>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function StudentInsightsDialog({
  open,
  onClose,
  meta,
  rows,
  onDeepAnalysis,
  studentProgressLoading,
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Student Insights - {meta.class_name}-{meta.section}
      </DialogTitle>
      <DialogContent dividers>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Student</TableCell>
                <TableCell>Attendance %</TableCell>
                <TableCell>Marks Avg</TableCell>
                <TableCell>Assignment Grade Avg</TableCell>
                <TableCell>Readiness</TableCell>
                <TableCell>NLP Risk Flags</TableCell>
                <TableCell>AI Feedback</TableCell>
                <TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(rows || []).map((row, idx) => (
                <TableRow key={`${row.username}-${idx}`}>
                  <TableCell>{row.name} ({row.username})</TableCell>
                  <TableCell>{row.attendance_percentage ?? 0}</TableCell>
                  <TableCell>{row.average_marks ?? 0}</TableCell>
                  <TableCell>{row.assignment_grade_average ?? "-"}</TableCell>
                  <TableCell>{row.readiness_score ?? 0}</TableCell>
                  <TableCell>{(row?.nlp?.risk_flags || []).join(", ") || "-"}</TableCell>
                  <TableCell>{row.ai_feedback || "-"}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => onDeepAnalysis(row.username)}
                      disabled={studentProgressLoading}
                    >
                      Deep Analysis
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(rows || []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>No student insight data available.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function StudentProgressDialog({ open, onClose, loading, data }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Student Progress Analysis - {data?.student?.name || "-"} ({data?.student?.username || "-"})
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}><StatCard label="Risk Level" value={data?.snapshot?.risk_level || "-"} /></Grid>
            <Grid item xs={12} md={4}><StatCard label="Readiness Score" value={data?.snapshot?.readiness_score ?? 0} /></Grid>
            <Grid item xs={12} md={4}><StatCard label="Momentum Score" value={data?.snapshot?.momentum_score ?? 0} /></Grid>
            <Grid item xs={12} md={4}><StatCard label="Attendance %" value={data?.snapshot?.attendance_percentage ?? 0} /></Grid>
            <Grid item xs={12} md={4}><StatCard label="Marks Avg" value={data?.snapshot?.average_marks ?? 0} /></Grid>
            <Grid item xs={12} md={4}><StatCard label="Assessment Avg" value={data?.snapshot?.average_assessment_score ?? 0} /></Grid>

            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Trend Summary</Typography>
                <Typography variant="body2">Marks: {data?.trends?.marks?.direction || "-"} ({data?.trends?.marks?.delta ?? 0})</Typography>
                <Typography variant="body2">Attendance: {data?.trends?.attendance?.direction || "-"} ({data?.trends?.attendance?.delta ?? 0})</Typography>
                <Typography variant="body2">Assignment Grade: {data?.trends?.assignment_grade?.direction || "-"} ({data?.trends?.assignment_grade?.delta ?? 0})</Typography>
                <Typography variant="body2">Assessment: {data?.trends?.assessment_score?.direction || "-"} ({data?.trends?.assessment_score?.delta ?? 0})</Typography>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Concern Flags</Typography>
                <Typography variant="body2">
                  {(data?.concern_flags || []).join(", ") || "No critical flags."}
                </Typography>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Recommended Actions</Typography>
                {(data?.recommended_actions || []).map((item, idx) => (
                  <Typography key={`${item}-${idx}`} variant="body2" sx={{ mb: 0.5 }}>
                    {idx + 1}. {item}
                  </Typography>
                ))}
                {(data?.recommended_actions || []).length === 0 && (
                  <Typography variant="body2">No recommendations available.</Typography>
                )}
              </Paper>
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function StudentsDialog({
  open,
  onClose,
  selectedClass,
  studentsLoading,
  studentsList,
  studentsSaving,
  onChangeField,
  onSaveStudent,
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Students - {selectedClass.class_name}-{selectedClass.section}
      </DialogTitle>
      <DialogContent dividers>
        {studentsLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Username</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Roll No</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {studentsList.map((student, idx) => (
                  <TableRow key={`${student.username}-${idx}`}>
                    <TableCell>{student.username || "-"}</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={student.edited_name || ""}
                        onChange={(e) => onChangeField(idx, "edited_name", e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={student.edited_roll_no || ""}
                        onChange={(e) => onChangeField(idx, "edited_roll_no", e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="contained"
                        size="small"
                        disabled={studentsSaving === student.username}
                        onClick={() => onSaveStudent(student)}
                      >
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
