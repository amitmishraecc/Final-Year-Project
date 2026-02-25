import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { apiFetch } from "../lib/api";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function monthLabel(value) {
  try {
    return new Date(value.getFullYear(), value.getMonth(), 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function shiftMonth(value, delta) {
  return new Date(value.getFullYear(), value.getMonth() + delta, 1);
}

function buildMonthCells(anchorMonth) {
  const start = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), 1);
  const startWeekday = start.getDay();
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - startWeekday);

  return Array.from({ length: 42 }).map((_, idx) => {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + idx);
    return {
      date: isoDate(current),
      day: current.getDate(),
      inMonth: current.getMonth() === anchorMonth.getMonth(),
    };
  });
}

function canSelectClassScope(role) {
  return role === "teacher" || role === "admin";
}

function canSelectGlobalScope(role) {
  return role === "admin";
}

function canCreatePublicHoliday(role) {
  return role === "admin";
}

function RoleCalendarWidget({ role = "student", classOptions = [], compact = false }) {
  const today = useMemo(() => new Date(), []);
  const [anchorMonth, setAnchorMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(isoDate(today));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    scope: role === "student" ? "personal" : "personal",
    class_name: classOptions?.[0]?.class_name || "",
    section: classOptions?.[0]?.section || "",
    event_type: "reminder",
  });
  const [eventDialogOpen, setEventDialogOpen] = useState(false);

  useEffect(() => {
    if (!Array.isArray(classOptions) || classOptions.length === 0) return;
    if (form.class_name && form.section) return;
    setForm((prev) => ({
      ...prev,
      class_name: classOptions[0].class_name || "",
      section: classOptions[0].section || "",
    }));
  }, [classOptions, form.class_name, form.section]);

  const monthCells = useMemo(() => buildMonthCells(anchorMonth), [anchorMonth]);

  const range = useMemo(() => {
    const first = monthCells[0]?.date;
    const last = monthCells[monthCells.length - 1]?.date;
    return { first, last };
  }, [monthCells]);

  const loadEvents = async () => {
    if (!range.first || !range.last) return;
    setLoading(true);
    setError("");
    try {
      const rows = await apiFetch(
        `/calendar/events?from_date=${encodeURIComponent(range.first)}&to_date=${encodeURIComponent(range.last)}`
      );
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err.message || "Failed to load calendar events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [range.first, range.last]);

  const eventMapByDate = useMemo(() => {
    const map = {};
    (events || []).forEach((item) => {
      const key = item?.date;
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }, [events]);

  const openCreateDialogForDate = (dateValue) => {
    setSelectedDate(dateValue);
    setEventDialogOpen(true);
    setError("");
    setMessage("");
  };

  const createEvent = async () => {
    if (!selectedDate) {
      setError("Please select a date");
      return;
    }
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    if (form.scope === "class_section" && (!form.class_name || !form.section)) {
      setError("Class and section are required for class event");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          date: selectedDate,
          scope: form.scope,
          class_name: form.scope === "class_section" ? form.class_name : undefined,
          section: form.scope === "class_section" ? form.section : undefined,
          event_type: form.event_type,
        }),
      });
      setMessage("Calendar event added");
      setForm((prev) => ({ ...prev, title: "", description: "" }));
      setEventDialogOpen(false);
      await loadEvents();
    } catch (err) {
      setError(err.message || "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card sx={{ mt: compact ? 0 : 2 }}>
      <CardContent>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h6">{compact ? "Calendar" : "Calendar, Holidays & Reminders"}</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => setAnchorMonth((prev) => shiftMonth(prev, -1))}>
              Prev
            </Button>
            <Button size="small" variant="outlined" onClick={() => setAnchorMonth((prev) => shiftMonth(prev, 1))}>
              Next
            </Button>
            <Button size="small" variant="contained" onClick={() => openCreateDialogForDate(selectedDate)}>
              Add
            </Button>
          </Box>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        {message && <Alert severity="success" sx={{ mb: 1.5 }}>{message}</Alert>}

        <Paper variant="outlined" sx={{ p: compact ? 1 : 1.5 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>{monthLabel(anchorMonth)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Double-click any date to add reminder/event.
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.6, mb: 1 }}>
            {WEEKDAYS.map((label) => (
              <Typography key={label} variant="caption" sx={{ textAlign: "center", fontWeight: 700 }}>
                {label}
              </Typography>
            ))}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.6 }}>
            {monthCells.map((cell) => {
              const dayEvents = eventMapByDate[cell.date] || [];
              const count = dayEvents.length;
              const selected = selectedDate === cell.date;
              const tooltipTitle = (
                <Box>
                  {dayEvents.slice(0, 6).map((item, idx) => (
                    <Typography key={`${cell.date}-${item.id || idx}`} variant="caption" sx={{ display: "block" }}>
                      {(item.event_type === "public_holiday" ? "Holiday: " : "") + (item.title || "Untitled")}
                    </Typography>
                  ))}
                  {dayEvents.length > 6 && (
                    <Typography variant="caption" sx={{ display: "block" }}>
                      +{dayEvents.length - 6} more
                    </Typography>
                  )}
                </Box>
              );
              return (
                <Tooltip
                  key={cell.date}
                  title={tooltipTitle}
                  arrow
                  placement="top"
                  disableHoverListener={dayEvents.length === 0}
                >
                  <Paper
                    variant="outlined"
                    onClick={() => setSelectedDate(cell.date)}
                    onDoubleClick={() => openCreateDialogForDate(cell.date)}
                    sx={{
                      p: 0.5,
                      minHeight: compact ? 42 : 52,
                      cursor: "pointer",
                      borderColor: selected ? "primary.main" : undefined,
                      bgcolor: selected ? "primary.50" : "transparent",
                      opacity: cell.inMonth ? 1 : 0.55,
                    }}
                  >
                    <Typography variant="caption" sx={{ display: "block", fontWeight: 700, lineHeight: 1.2 }}>
                      {cell.day}
                    </Typography>
                    {count > 0 && (
                      <Chip
                        size="small"
                        label={count}
                        color="primary"
                        sx={{ height: 18, "& .MuiChip-label": { px: 0.75 } }}
                      />
                    )}
                  </Paper>
                </Tooltip>
              );
            })}
          </Box>
        </Paper>

        <Dialog open={eventDialogOpen} onClose={() => setEventDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Add Event - {selectedDate || "-"}</DialogTitle>
          <DialogContent dividers>
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Title"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  minRows={2}
                  label="Description"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Date"
                  InputLabelProps={{ shrink: true }}
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  select
                  label="Scope"
                  value={form.scope}
                  onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value }))}
                >
                  <MenuItem value="personal">Personal</MenuItem>
                  {canSelectClassScope(role) && <MenuItem value="class_section">Class + Section</MenuItem>}
                  {canSelectGlobalScope(role) && <MenuItem value="global">Global</MenuItem>}
                </TextField>
              </Grid>
              {form.scope === "class_section" && (
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    select
                    label="Class + Section"
                    value={`${form.class_name}-${form.section}`}
                    onChange={(e) => {
                      const [className, section] = String(e.target.value || "").split("-");
                      setForm((prev) => ({ ...prev, class_name: className || "", section: section || "" }));
                    }}
                  >
                    {(classOptions || []).map((item) => {
                      const key = `${item.class_name}-${item.section}`;
                      return (
                        <MenuItem key={key} value={key}>
                          {key}
                        </MenuItem>
                      );
                    })}
                  </TextField>
                </Grid>
              )}
              {canCreatePublicHoliday(role) && (
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    select
                    label="Type"
                    value={form.event_type}
                    onChange={(e) => setForm((prev) => ({ ...prev, event_type: e.target.value }))}
                  >
                    <MenuItem value="reminder">Reminder</MenuItem>
                    <MenuItem value="public_holiday">Public Holiday</MenuItem>
                  </TextField>
                </Grid>
              )}
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEventDialogOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={createEvent} disabled={saving || loading}>
              {saving ? "Saving..." : "Save Event"}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default RoleCalendarWidget;
