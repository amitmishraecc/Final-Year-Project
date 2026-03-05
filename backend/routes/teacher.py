from datetime import date, datetime, timedelta
from email.message import EmailMessage
import os
import re
import smtplib
from statistics import mean, pstdev

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import attendance_collection, db, users_collection
from utils.roles import require_teacher

router = APIRouter(prefix="/teacher", tags=["Teacher"])
performance_collection = db["performance_records"]
interventions_collection = db["interventions"]
subject_assignments_collection = db["subject_teacher_assignments"]
teacher_assignments_collection = db["student_assignments"]
assessment_attempts_collection = db["assessment_attempts"]
assignment_reminders_collection = db["assignment_reminders"]


class AttendanceRecord(BaseModel):
    student_id: str = Field(..., min_length=1)
    status: str


class AttendancePayload(BaseModel):
    class_name: str
    section: str
    date: str
    records: list[AttendanceRecord]


class TeacherAssignmentCreateIn(BaseModel):
    class_name: str
    section: str
    subject_code: str = Field(..., min_length=1)
    assignment_type: str = Field(..., pattern="^(common|personal)$")
    title: str = Field(..., min_length=1)
    topic: str = ""
    question: str = ""
    content_html: str = ""
    due_date: str | None = None
    max_marks: float = Field(default=100, gt=0)
    student_username: str | None = None


class TeacherAssignmentStatusIn(BaseModel):
    status: str = Field(..., pattern="^(assigned|completed)$")


class AssignmentOutcomeIn(BaseModel):
    student_username: str = Field(..., min_length=1)
    is_completed: bool = False
    completed_on_time: bool | None = None
    grade_score: float | None = Field(default=None, ge=0)
    feedback: str = ""


class AssignmentOutcomeBatchIn(BaseModel):
    outcomes: list[AssignmentOutcomeIn] = Field(default_factory=list)


class AssignmentReminderRunIn(BaseModel):
    class_name: str | None = None
    section: str | None = None
    days_before_due: int = Field(default=1, ge=0, le=30)


def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _parse_due_date(due_date: str | None) -> datetime | None:
    if not due_date:
        return None
    try:
        return datetime.fromisoformat(f"{due_date}T23:59:59")
    except Exception:
        return None


def _derive_submission_status(due_date: str | None, outcome: dict | None) -> str:
    outcome = outcome or {}
    if bool(outcome.get("is_completed")):
        completed_on_time = outcome.get("completed_on_time")
        if completed_on_time is False:
            return "late"
        completed_at = outcome.get("completed_at")
        due_dt = _parse_due_date(due_date)
        if due_dt and completed_at:
            try:
                completed_dt = datetime.fromisoformat(str(completed_at).replace("Z", ""))
                return "late" if completed_dt > due_dt else "submitted"
            except Exception:
                pass
        return "submitted"
    return "missing"


def _smtp_config() -> dict:
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "username": os.getenv("SMTP_USERNAME", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        "from_email": os.getenv("SMTP_FROM", "").strip() or os.getenv("SMTP_USERNAME", "").strip(),
        "use_tls": str(os.getenv("SMTP_USE_TLS", "true")).lower() in {"1", "true", "yes"},
    }


def _send_email(to_email: str, subject: str, body: str) -> tuple[bool, str]:
    cfg = _smtp_config()
    if not cfg["host"] or not cfg["from_email"]:
        return False, "SMTP config missing (SMTP_HOST/SMTP_FROM)"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg["from_email"]
    msg["To"] = to_email
    msg.set_content(body)

    try:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as server:
            if cfg["use_tls"]:
                server.starttls()
            if cfg["username"] and cfg["password"]:
                server.login(cfg["username"], cfg["password"])
            server.send_message(msg)
        return True, "sent"
    except Exception as exc:
        return False, str(exc)


def _trend_stats(values: list[float]) -> dict:
    cleaned = [_to_float(v) for v in values]
    if len(cleaned) < 4:
        avg = round(mean(cleaned), 2) if cleaned else 0.0
        return {
            "direction": "stable",
            "delta": 0.0,
            "previous_avg": avg,
            "recent_avg": avg,
        }

    split = len(cleaned) // 2
    previous = cleaned[:split]
    recent = cleaned[split:]
    previous_avg = round(mean(previous), 2) if previous else 0.0
    recent_avg = round(mean(recent), 2) if recent else 0.0
    delta = round(recent_avg - previous_avg, 2)
    if delta >= 2:
        direction = "improving"
    elif delta <= -2:
        direction = "declining"
    else:
        direction = "stable"
    return {
        "direction": direction,
        "delta": delta,
        "previous_avg": previous_avg,
        "recent_avg": recent_avg,
    }


def _consistency_score(values: list[float]) -> float:
    cleaned = [_to_float(v) for v in values]
    if len(cleaned) < 2:
        return 100.0 if cleaned else 0.0
    deviation = _to_float(pstdev(cleaned), 0.0)
    return round(max(0.0, min(100.0, 100.0 - (deviation * 2.0))), 2)


def _risk_level(score: float) -> str:
    if score >= 80:
        return "Low"
    if score >= 60:
        return "Moderate"
    if score >= 40:
        return "High"
    return "Critical"


def _is_assigned(user: dict, class_name: str, section: str) -> bool:
    return any(
        item.get("class_name") == class_name and item.get("section") == section
        for item in user.get("assigned_classes", [])
    )


def _ensure_assigned(user: dict, class_name: str, section: str) -> None:
    if not _is_assigned(user, class_name, section):
        raise HTTPException(status_code=403, detail="Class not assigned to teacher")


def _ensure_subject_assigned(user: dict, class_name: str, section: str, subject_code: str) -> None:
    assignment = subject_assignments_collection.find_one(
        {
            "class_name": class_name,
            "section": section,
            "subject_code": subject_code,
            "teacher_username": user.get("username"),
        },
        {"_id": 1},
    )
    if not assignment:
        raise HTTPException(
            status_code=403,
            detail="Subject is not assigned to this teacher for selected class/section",
        )


def _grade_label(score: float | None) -> str | None:
    if score is None:
        return None
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "F"


def _feedback_nlp(feedback: str, grade_score: float | None, is_completed: bool) -> dict:
    text = str(feedback or "").strip().lower()
    tokens = re.findall(r"[a-zA-Z]{3,}", text)
    stopwords = {
        "the", "and", "for", "with", "that", "this", "from", "have", "has", "was", "were", "are", "but", "not",
        "very", "good", "bad", "needs", "need", "more", "work", "student", "assignment", "task", "done",
    }
    freq = {}
    for token in tokens:
        if token in stopwords:
            continue
        freq[token] = freq.get(token, 0) + 1
    keywords = [k for k, _ in sorted(freq.items(), key=lambda x: x[1], reverse=True)[:5]]

    positive_words = {"excellent", "improved", "clear", "strong", "accurate", "creative", "consistent", "good"}
    negative_words = {"weak", "late", "poor", "incomplete", "confused", "incorrect", "missing", "low"}
    pos = sum(1 for t in tokens if t in positive_words)
    neg = sum(1 for t in tokens if t in negative_words)
    sentiment_score = pos - neg
    sentiment = "positive" if sentiment_score > 0 else "negative" if sentiment_score < 0 else "neutral"

    risk_flags = []
    if not is_completed:
        risk_flags.append("NOT_COMPLETED")
    if grade_score is not None and grade_score < 40:
        risk_flags.append("LOW_ASSIGNMENT_GRADE")
    if any(w in text for w in ["late", "delay", "deadline"]):
        risk_flags.append("LATE_SUBMISSION_RISK")
    if any(w in text for w in ["confused", "concept", "clarity", "doubt"]):
        risk_flags.append("CONCEPT_CLARITY_RISK")

    return {
        "sentiment": sentiment,
        "sentiment_score": sentiment_score,
        "keywords": keywords,
        "risk_flags": risk_flags,
    }


def _is_completed_on_time(due_date: str | None, completed_at: str | None) -> bool | None:
    if not due_date or not completed_at:
        return None
    try:
        due_dt = datetime.fromisoformat(f"{due_date}T23:59:59")
        completed_dt = datetime.fromisoformat(completed_at.replace("Z", ""))
    except Exception:
        return None
    return completed_dt <= due_dt


def _allowed_assignment_students(doc: dict) -> list[str]:
    if doc.get("assignment_type") == "personal":
        target = str(doc.get("target_username") or "").strip()
        return [target] if target else []
    rows = list(
        users_collection.find(
            {
                "role": "student",
                "class_name": doc.get("class_name"),
                "section": doc.get("section"),
            },
            {"_id": 0, "username": 1},
        )
    )
    return sorted({str(item.get("username") or "").strip() for item in rows if item.get("username")})


def _attendance_pct_for_student(student_id: str, class_name: str, section: str) -> float:
    docs = list(
        attendance_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0, "records": 1},
        )
    )
    total = 0
    present = 0
    for doc in docs:
        for rec in doc.get("records", []):
            rec_id = str(rec.get("student_id") or rec.get("roll_no") or "").strip()
            if rec_id != student_id:
                continue
            total += 1
            if str(rec.get("status", "")).lower() == "present":
                present += 1
    return round((present / total) * 100, 2) if total else 0.0


def _normalized_outcome(
    raw: dict,
    due_date: str | None,
    max_marks: float = 100.0,
    existing: dict | None = None,
) -> dict:
    existing = existing or {}
    username = str(raw.get("student_username") or existing.get("student_username") or "").strip()
    is_completed = bool(raw.get("is_completed", existing.get("is_completed", False)))

    completed_at = existing.get("completed_at")
    if is_completed and not completed_at:
        completed_at = datetime.utcnow().isoformat()
    if not is_completed:
        completed_at = None

    grade_score = raw.get("grade_score", existing.get("grade_score"))
    if grade_score is not None:
        grade_score = max(0.0, min(float(max_marks), float(grade_score)))
    feedback = str(raw.get("feedback", existing.get("feedback", "")) or "").strip()

    completed_on_time = raw.get("completed_on_time", existing.get("completed_on_time"))
    if completed_on_time is None:
        completed_on_time = _is_completed_on_time(due_date, completed_at) if is_completed else None

    nlp_analysis = _feedback_nlp(feedback, grade_score, is_completed)
    return {
        "student_username": username,
        "is_completed": is_completed,
        "completed_at": completed_at,
        "completed_on_time": completed_on_time,
        "submission_status": _derive_submission_status(due_date, {"is_completed": is_completed, "completed_on_time": completed_on_time, "completed_at": completed_at}),
        "grade_score": grade_score,
        "grade_label": _grade_label(grade_score),
        "feedback": feedback,
        "nlp_analysis": nlp_analysis,
        "updated_at": datetime.utcnow().isoformat(),
    }

@router.get("/classes")
def get_assigned_classes(user=Depends(require_teacher)):
    return user.get("assigned_classes", [])


@router.get("/class-summary")
def get_class_summary(user=Depends(require_teacher)):
    summaries = []
    for item in user.get("assigned_classes", []):
        class_name = item.get("class_name")
        section = item.get("section")
        if not class_name or not section:
            continue

        students_count = users_collection.count_documents(
            {"role": "student", "class_name": class_name, "section": section}
        )
        latest_attendance = attendance_collection.find_one(
            {"class_name": class_name, "section": section},
            {"_id": 0, "date": 1},
            sort=[("date", -1)],
        )
        summaries.append(
            {
                "class_name": class_name,
                "section": section,
                "students_count": students_count,
                "last_attendance_date": latest_attendance.get("date") if latest_attendance else None,
            }
        )
    return summaries


@router.get("/students")
def get_students(
    class_name: str = Query(...),
    section: str = Query(...),
    user=Depends(require_teacher),
):
    _ensure_assigned(user, class_name, section)
    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "password": 0},
        )
    )
    if not students:
        students = list(
            db["students"].find(
                {"class_name": class_name, "section": section},
                {"_id": 0},
            )
        )
    normalized = []
    for student in students:
        student_id = student.get("roll_no") or student.get("username")
        if not student_id:
            continue
        normalized.append(
            {
                "student_id": str(student_id),
                "name": student.get("name") or student.get("full_name") or student.get("username", ""),
                "roll_no": student.get("roll_no", ""),
                "username": student.get("username", ""),
            }
        )
    return normalized


@router.put("/students/{username}")
def update_student_record(username: str, data: dict, user=Depends(require_teacher)):
    student = users_collection.find_one({"username": username, "role": "student"})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    class_name = student.get("class_name")
    section = student.get("section")
    _ensure_assigned(user, class_name, section)

    updates = {}
    if data.get("name") is not None:
        updates["name"] = str(data["name"]).strip()
    if data.get("roll_no") is not None:
        updates["roll_no"] = str(data["roll_no"]).strip()

    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields provided")

    users_collection.update_one({"username": username}, {"$set": updates})
    return {"message": "Student record updated"}


@router.get("/attendance")
def get_attendance_for_date(class_name: str, section: str, date: str, user=Depends(require_teacher)):
    _ensure_assigned(user, class_name, section)
    attendance = attendance_collection.find_one(
        {"class_name": class_name, "section": section, "date": date},
        {"_id": 0},
    )
    return attendance or {"class_name": class_name, "section": section, "date": date, "records": []}


@router.post("/attendance")
def mark_attendance(payload: AttendancePayload, user=Depends(require_teacher)):
    _ensure_assigned(user, payload.class_name, payload.section)
    if not payload.records:
        raise HTTPException(status_code=400, detail="Attendance records are required")
    records = []
    for record in payload.records:
        status = record.status.strip().capitalize()
        if status not in {"Present", "Absent"}:
            raise HTTPException(status_code=400, detail="Status must be Present or Absent")
        records.append({"student_id": record.student_id.strip(), "status": status})

    attendance_collection.update_one(
        {"class_name": payload.class_name, "section": payload.section, "date": payload.date},
        {
            "$set": {
                "class_name": payload.class_name,
                "section": payload.section,
                "date": payload.date,
                "teacher_username": user["username"],
                "records": records,
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
        upsert=True,
    )
    return {"message": "Attendance saved"}


@router.post("/assignments")
def create_teacher_assignment(payload: TeacherAssignmentCreateIn, user=Depends(require_teacher)):
    _ensure_assigned(user, payload.class_name, payload.section)
    subject_code = (payload.subject_code or "").strip() or "GENERAL"

    topic = (payload.topic or "").strip()
    question = (payload.question or "").strip()
    content_html = (payload.content_html or "").strip()
    if not payload.due_date:
        raise HTTPException(status_code=400, detail="due_date is required for assignment lifecycle")
    if not _parse_due_date(payload.due_date):
        raise HTTPException(status_code=400, detail="Invalid due_date format. Expected YYYY-MM-DD")
    if not topic and not question and not content_html:
        raise HTTPException(status_code=400, detail="At least one of topic, question, or content_html is required")

    target_username = (payload.student_username or "").strip()
    if payload.assignment_type == "personal":
        if not target_username:
            raise HTTPException(status_code=400, detail="student_username is required for personal assignment")
        student = users_collection.find_one(
            {
                "username": target_username,
                "role": "student",
                "class_name": payload.class_name,
                "section": payload.section,
            },
            {"_id": 0, "username": 1},
        )
        if not student:
            raise HTTPException(status_code=404, detail="Target student not found in selected class/section")
    else:
        target_username = None

    doc = {
        "teacher_username": user.get("username"),
        "class_name": payload.class_name,
        "section": payload.section,
        "subject_code": subject_code,
        "assignment_type": payload.assignment_type,
        "title": payload.title.strip(),
        "topic": topic,
        "question": question,
        "content_html": content_html,
        "due_date": payload.due_date,
        "max_marks": float(payload.max_marks),
        "target_username": target_username,
        "status": "assigned",
        "completed_usernames": [],
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = teacher_assignments_collection.insert_one(doc)
    return {"message": "Assignment created", "id": str(result.inserted_id)}


@router.get("/assignments")
def list_teacher_assignments(
    class_name: str | None = Query(None),
    section: str | None = Query(None),
    assignment_type: str | None = Query(None),
    user=Depends(require_teacher),
):
    query = {"teacher_username": user.get("username")}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section
    if assignment_type:
        query["assignment_type"] = assignment_type

    rows = list(teacher_assignments_collection.find(query).sort("updated_at", -1).limit(300))
    out = []
    for row in rows:
        completed_usernames = row.get("completed_usernames") or []
        due_date = row.get("due_date")
        outcomes = row.get("student_outcomes") or []
        outcome_map = {
            str(item.get("student_username") or "").strip(): item
            for item in outcomes
            if item.get("student_username")
        }
        allowed_students = _allowed_assignment_students(row)
        submitted_count = 0
        late_count = 0
        missing_count = 0
        for username in allowed_students:
            outcome = outcome_map.get(username, {"is_completed": username in completed_usernames})
            status = _derive_submission_status(due_date, outcome)
            if status == "submitted":
                submitted_count += 1
            elif status == "late":
                late_count += 1
            else:
                missing_count += 1
        row["id"] = str(row["_id"])
        row.pop("_id", None)
        row["completed_count"] = len(completed_usernames)
        if row.get("assignment_type") == "personal":
            row["completed_count"] = 1 if row.get("status") == "completed" else 0
        row["submission_summary"] = {
            "submitted": submitted_count,
            "late": late_count,
            "missing": missing_count,
            "total": len(allowed_students),
        }
        out.append(row)
    return out


@router.get("/assignments/{assignment_id}/outcomes")
def get_assignment_outcomes(assignment_id: str, user=Depends(require_teacher)):
    if not ObjectId.is_valid(assignment_id):
        raise HTTPException(status_code=400, detail="Invalid assignment id")
    doc = teacher_assignments_collection.find_one({"_id": ObjectId(assignment_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if doc.get("teacher_username") != user.get("username"):
        raise HTTPException(status_code=403, detail="Not allowed")

    allowed_students = _allowed_assignment_students(doc)
    existing_rows = {
        str(item.get("student_username") or "").strip(): item
        for item in (doc.get("student_outcomes") or [])
        if item.get("student_username")
    }
    completed_usernames = {str(item).strip() for item in (doc.get("completed_usernames") or [])}
    due_date = doc.get("due_date")
    max_marks = _to_float(doc.get("max_marks"), 100.0)

    rows = []
    for username in allowed_students:
        existing = existing_rows.get(username, {})
        default_completed = username in completed_usernames
        merged = _normalized_outcome(
            {
                "student_username": username,
                "is_completed": existing.get("is_completed", default_completed),
                "completed_on_time": existing.get("completed_on_time"),
                "grade_score": existing.get("grade_score"),
                "feedback": existing.get("feedback", ""),
            },
            due_date,
            max_marks=max_marks,
            existing=existing,
        )
        merged["submission_status"] = _derive_submission_status(due_date, merged)
        rows.append(merged)

    return {
        "assignment_id": assignment_id,
        "title": doc.get("title"),
        "assignment_type": doc.get("assignment_type"),
        "class_name": doc.get("class_name"),
        "section": doc.get("section"),
        "due_date": due_date,
        "max_marks": doc.get("max_marks", 100),
        "rows": rows,
    }


@router.put("/assignments/{assignment_id}/outcomes")
def save_assignment_outcomes(assignment_id: str, payload: AssignmentOutcomeBatchIn, user=Depends(require_teacher)):
    if not ObjectId.is_valid(assignment_id):
        raise HTTPException(status_code=400, detail="Invalid assignment id")
    doc = teacher_assignments_collection.find_one({"_id": ObjectId(assignment_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if doc.get("teacher_username") != user.get("username"):
        raise HTTPException(status_code=403, detail="Not allowed")

    allowed_students = set(_allowed_assignment_students(doc))
    if not allowed_students:
        raise HTTPException(status_code=400, detail="No students found for this assignment")

    existing_map = {
        str(item.get("student_username") or "").strip(): item
        for item in (doc.get("student_outcomes") or [])
        if item.get("student_username")
    }
    due_date = doc.get("due_date")
    max_marks = _to_float(doc.get("max_marks"), 100.0)

    outcome_map = dict(existing_map)
    for row in payload.outcomes:
        username = str(row.student_username or "").strip()
        if not username:
            continue
        if username not in allowed_students:
            raise HTTPException(status_code=400, detail=f"{username} is not allowed for this assignment")
        outcome_map[username] = _normalized_outcome(
            row.model_dump(),
            due_date,
            max_marks=max_marks,
            existing=existing_map.get(username),
        )

    final_rows = []
    for username in sorted(allowed_students):
        item = outcome_map.get(
            username,
            _normalized_outcome(
                {"student_username": username, "is_completed": False, "feedback": ""},
                due_date,
                max_marks=max_marks,
            ),
        )
        item["submission_status"] = _derive_submission_status(due_date, item)
        final_rows.append(item)

    completed_usernames = [row["student_username"] for row in final_rows if row.get("is_completed")]
    is_all_completed = len(completed_usernames) == len(allowed_students)
    new_status = "completed" if is_all_completed else "assigned"

    update = {
        "student_outcomes": final_rows,
        "completed_usernames": completed_usernames,
        "status": new_status,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if new_status == "completed":
        update["completed_at"] = datetime.utcnow().isoformat()
    teacher_assignments_collection.update_one({"_id": doc["_id"]}, {"$set": update})

    return {
        "message": "Assignment outcomes saved",
        "status": new_status,
        "completed_count": len(completed_usernames),
        "total_students": len(allowed_students),
    }


@router.post("/assignments/send-reminders")
def run_assignment_reminders(payload: AssignmentReminderRunIn, user=Depends(require_teacher)):
    query = {"teacher_username": user.get("username"), "due_date": {"$ne": None}}
    if payload.class_name:
        query["class_name"] = payload.class_name
    if payload.section:
        query["section"] = payload.section
    rows = list(teacher_assignments_collection.find(query).limit(500))
    if not rows:
        return {"checked_assignments": 0, "sent": 0, "skipped": 0, "failed": 0, "details": []}

    # Cache student contacts once for all assigned class/section combinations
    email_map = {}
    student_rows = list(
        users_collection.find(
            {"role": "student"},
            {"_id": 0, "username": 1, "email": 1},
        )
    )
    for item in student_rows:
        username = str(item.get("username") or "").strip()
        if not username:
            continue
        email = str(item.get("email") or "").strip()
        if not email and "@" in username:
            email = username
        email_map[username] = email

    now = datetime.utcnow()
    sent = 0
    skipped = 0
    failed = 0
    details = []

    for doc in rows:
        due_dt = _parse_due_date(doc.get("due_date"))
        if not due_dt:
            continue

        due_in_days = (due_dt.date() - now.date()).days
        due_passed = now.date() > due_dt.date()
        if not due_passed and due_in_days > payload.days_before_due:
            continue

        allowed_students = _allowed_assignment_students(doc)
        outcomes = doc.get("student_outcomes") or []
        outcome_map = {
            str(item.get("student_username") or "").strip(): item
            for item in outcomes
            if item.get("student_username")
        }
        completed_usernames = set(str(x).strip() for x in (doc.get("completed_usernames") or []))

        for username in allowed_students:
            outcome = outcome_map.get(username, {"is_completed": username in completed_usernames})
            submission_status = _derive_submission_status(doc.get("due_date"), outcome)
            if submission_status in {"submitted", "late"}:
                skipped += 1
                continue

            reminder_type = "after_due" if due_passed else "before_due"
            reminder_key = {
                "assignment_id": str(doc["_id"]),
                "student_username": username,
                "reminder_type": reminder_type,
            }
            if assignment_reminders_collection.find_one(reminder_key, {"_id": 1}):
                skipped += 1
                continue

            to_email = email_map.get(username, "")
            if not to_email:
                failed += 1
                details.append(
                    {
                        "assignment_id": str(doc["_id"]),
                        "student_username": username,
                        "status": "failed",
                        "reason": "Email not available for student",
                    }
                )
                continue

            title = str(doc.get("title") or "Assignment")
            subject = f"Reminder: {title} ({'Overdue' if due_passed else 'Due Soon'})"
            if due_passed:
                body = (
                    f"Hello {username},\n\n"
                    f"Your assignment '{title}' was due on {doc.get('due_date')} and is still marked missing.\n"
                    f"Please submit/complete it as soon as possible.\n\n"
                    f"Teacher: {doc.get('teacher_username')}\n"
                )
            else:
                body = (
                    f"Hello {username},\n\n"
                    f"Reminder: Your assignment '{title}' is due on {doc.get('due_date')}.\n"
                    f"Please complete it before the deadline.\n\n"
                    f"Teacher: {doc.get('teacher_username')}\n"
                )

            ok, message = _send_email(to_email, subject, body)
            if not ok:
                failed += 1
                details.append(
                    {
                        "assignment_id": str(doc["_id"]),
                        "student_username": username,
                        "status": "failed",
                        "reason": message,
                    }
                )
                continue

            assignment_reminders_collection.insert_one(
                {
                    **reminder_key,
                    "assignment_title": title,
                    "due_date": doc.get("due_date"),
                    "to_email": to_email,
                    "sent_at": datetime.utcnow().isoformat(),
                    "teacher_username": user.get("username"),
                }
            )
            sent += 1
            details.append(
                {
                    "assignment_id": str(doc["_id"]),
                    "student_username": username,
                    "status": "sent",
                    "reminder_type": reminder_type,
                }
            )

    return {
        "checked_assignments": len(rows),
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
        "details": details[:200],
    }


@router.get("/student-insights")
def get_student_insights(class_name: str, section: str, user=Depends(require_teacher)):
    _ensure_assigned(user, class_name, section)
    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "username": 1, "name": 1, "roll_no": 1},
        )
    )
    assignment_docs = list(
        teacher_assignments_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0, "student_outcomes": 1},
        )
    )

    insights = []
    for student in students:
        username = str(student.get("username") or "").strip()
        student_id = str(student.get("roll_no") or username).strip()
        if not username:
            continue

        perf_rows = list(
            performance_collection.find(
                {"class_name": class_name, "section": section, "student_id": student_id},
                {"_id": 0, "marks": 1, "assignment_score": 1, "co_curricular_score": 1},
            )
        )
        marks_avg = round(sum(float(r.get("marks", 0)) for r in perf_rows) / len(perf_rows), 2) if perf_rows else 0.0
        assign_avg = (
            round(sum(float(r.get("assignment_score", 0)) for r in perf_rows) / len(perf_rows), 2) if perf_rows else 0.0
        )
        co_avg = (
            round(sum(float(r.get("co_curricular_score", 0)) for r in perf_rows) / len(perf_rows), 2) if perf_rows else 0.0
        )
        attendance_pct = _attendance_pct_for_student(student_id, class_name, section)

        outcomes = []
        for doc in assignment_docs:
            for outcome in (doc.get("student_outcomes") or []):
                if str(outcome.get("student_username") or "").strip() == username:
                    outcomes.append(outcome)
        grade_scores = [float(o.get("grade_score")) for o in outcomes if o.get("grade_score") is not None]
        avg_assignment_grade = round(sum(grade_scores) / len(grade_scores), 2) if grade_scores else None
        feedback_text = " ".join(str(o.get("feedback") or "") for o in outcomes).strip()
        nlp = _feedback_nlp(feedback_text, avg_assignment_grade, any(bool(o.get("is_completed")) for o in outcomes))

        readiness = round((marks_avg * 0.45) + ((avg_assignment_grade or assign_avg) * 0.35) + (attendance_pct * 0.2), 2)
        ai_feedback = (
            f"{student.get('name') or username}: attendance {attendance_pct}%, marks {marks_avg}, "
            f"assignment grade {avg_assignment_grade if avg_assignment_grade is not None else '-'}; "
            f"sentiment {nlp.get('sentiment')}, focus on {', '.join(nlp.get('keywords') or ['consistency'])}."
        )

        insights.append(
            {
                "username": username,
                "name": student.get("name") or username,
                "roll_no": student.get("roll_no", ""),
                "attendance_percentage": attendance_pct,
                "average_marks": marks_avg,
                "average_assignment_score": assign_avg,
                "average_co_curricular_score": co_avg,
                "assignment_grade_average": avg_assignment_grade,
                "nlp": nlp,
                "ai_feedback": ai_feedback,
                "readiness_score": readiness,
            }
        )

    insights.sort(key=lambda row: row.get("readiness_score", 0), reverse=True)
    return {"class_name": class_name, "section": section, "students": insights}


@router.get("/student-progress-analysis")
def get_student_progress_analysis(
    class_name: str = Query(...),
    section: str = Query(...),
    student_username: str = Query(...),
    user=Depends(require_teacher),
):
    _ensure_assigned(user, class_name, section)
    student = users_collection.find_one(
        {
            "role": "student",
            "class_name": class_name,
            "section": section,
            "username": student_username,
        },
        {"_id": 0, "username": 1, "name": 1, "roll_no": 1},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found in selected class/section")

    student_id = str(student.get("roll_no") or student.get("username") or "").strip()
    if not student_id:
        raise HTTPException(status_code=400, detail="Student identifier missing")

    perf_rows = list(
        performance_collection.find(
            {"class_name": class_name, "section": section, "student_id": student_id},
            {"_id": 0, "date": 1, "marks": 1, "assignment_score": 1, "co_curricular_score": 1},
        ).sort("date", 1)
    )
    marks_series = [_to_float(item.get("marks")) for item in perf_rows]
    assignment_series = [_to_float(item.get("assignment_score")) for item in perf_rows]
    co_series = [_to_float(item.get("co_curricular_score")) for item in perf_rows]

    attendance_docs = list(
        attendance_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0, "date": 1, "records": 1},
        ).sort("date", 1)
    )
    attendance_events = []
    for doc in attendance_docs:
        date_value = str(doc.get("date") or "")
        for rec in doc.get("records", []):
            rec_id = str(rec.get("student_id") or rec.get("roll_no") or "").strip()
            if rec_id != student_id:
                continue
            status = str(rec.get("status") or "").lower()
            attendance_events.append(
                {
                    "date": date_value,
                    "status": status,
                    "score": 100.0 if status == "present" else 0.0,
                }
            )
    attendance_scores = [item["score"] for item in attendance_events]
    attendance_pct = round(mean(attendance_scores), 2) if attendance_scores else 0.0

    assignment_docs = list(
        teacher_assignments_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0, "title": 1, "subject_code": 1, "due_date": 1, "student_outcomes": 1},
        )
    )
    student_outcomes = []
    for doc in assignment_docs:
        for outcome in doc.get("student_outcomes") or []:
            if str(outcome.get("student_username") or "").strip() != student_username:
                continue
            student_outcomes.append(
                {
                    "title": doc.get("title"),
                    "subject_code": doc.get("subject_code"),
                    "due_date": doc.get("due_date"),
                    "is_completed": bool(outcome.get("is_completed")),
                    "completed_on_time": outcome.get("completed_on_time"),
                    "grade_score": outcome.get("grade_score"),
                    "feedback": outcome.get("feedback"),
                    "nlp_analysis": outcome.get("nlp_analysis") or {},
                    "updated_at": outcome.get("updated_at"),
                }
            )

    completed_count = sum(1 for item in student_outcomes if item.get("is_completed"))
    on_time_count = sum(1 for item in student_outcomes if item.get("completed_on_time") is True)
    assignment_grade_values = [_to_float(item.get("grade_score")) for item in student_outcomes if item.get("grade_score") is not None]

    completion_rate = round((completed_count / len(student_outcomes)) * 100, 2) if student_outcomes else 0.0
    on_time_rate = round((on_time_count / len(student_outcomes)) * 100, 2) if student_outcomes else 0.0
    avg_assignment_grade = round(mean(assignment_grade_values), 2) if assignment_grade_values else 0.0

    attempts = list(
        assessment_attempts_collection.find(
            {
                "student_username": student_username,
                "class_name": class_name,
                "section": section,
                "status": {"$in": ["submitted", "auto_locked"]},
            },
            {"_id": 0, "score_percentage": 1, "status": 1, "submitted_at": 1, "topic": 1},
        ).sort("submitted_at", 1)
    )
    assessment_scores = [_to_float(item.get("score_percentage")) for item in attempts]
    assessment_avg = round(mean(assessment_scores), 2) if assessment_scores else 0.0
    assessment_locked = sum(1 for item in attempts if item.get("status") == "auto_locked")

    marks_avg = round(mean(marks_series), 2) if marks_series else 0.0
    assignment_perf_avg = round(mean(assignment_series), 2) if assignment_series else 0.0
    co_avg = round(mean(co_series), 2) if co_series else 0.0

    marks_trend = _trend_stats(marks_series)
    attendance_trend = _trend_stats(attendance_scores)
    assignment_grade_trend = _trend_stats(assignment_grade_values)
    assessment_trend = _trend_stats(assessment_scores)

    consistency = {
        "marks_consistency": _consistency_score(marks_series),
        "attendance_consistency": _consistency_score(attendance_scores),
        "assignment_consistency": _consistency_score(assignment_grade_values),
        "assessment_consistency": _consistency_score(assessment_scores),
    }

    readiness_score = round(
        (marks_avg * 0.35)
        + (attendance_pct * 0.25)
        + (avg_assignment_grade * 0.20)
        + (assessment_avg * 0.20),
        2,
    )
    momentum_score = round(
        50.0
        + (marks_trend["delta"] * 2.0)
        + (attendance_trend["delta"] * 0.8)
        + (assignment_grade_trend["delta"] * 1.2)
        + (assessment_trend["delta"] * 1.0),
        2,
    )
    momentum_score = max(0.0, min(100.0, momentum_score))

    concern_flags = []
    if attendance_pct < 75:
        concern_flags.append("LOW_ATTENDANCE")
    if marks_avg < 40:
        concern_flags.append("LOW_MARKS")
    if completion_rate < 60:
        concern_flags.append("LOW_ASSIGNMENT_COMPLETION")
    if avg_assignment_grade and avg_assignment_grade < 45:
        concern_flags.append("LOW_ASSIGNMENT_QUALITY")
    if assessment_avg and assessment_avg < 45:
        concern_flags.append("LOW_ASSESSMENT_PERFORMANCE")
    if marks_trend["direction"] == "declining":
        concern_flags.append("MARKS_DECLINING")
    if attendance_trend["direction"] == "declining":
        concern_flags.append("ATTENDANCE_DECLINING")
    if assessment_locked > 0:
        concern_flags.append("ASSESSMENT_DISCIPLINE_RISK")

    strengths = []
    if attendance_pct >= 85:
        strengths.append("Strong attendance consistency")
    if marks_avg >= 70:
        strengths.append("Good academic marks baseline")
    if completion_rate >= 85:
        strengths.append("Reliable assignment completion")
    if avg_assignment_grade >= 70:
        strengths.append("Strong assignment quality")
    if assessment_avg >= 70:
        strengths.append("Healthy assessment performance")
    if marks_trend["direction"] == "improving":
        strengths.append("Marks trend improving")
    if assessment_trend["direction"] == "improving":
        strengths.append("Assessment trend improving")

    action_plan = []
    if "LOW_ATTENDANCE" in concern_flags or "ATTENDANCE_DECLINING" in concern_flags:
        action_plan.append("Set weekly attendance target with parent follow-up and class mentor check-ins.")
    if "LOW_MARKS" in concern_flags or "MARKS_DECLINING" in concern_flags:
        action_plan.append("Start 2-week remedial cycle focused on weakest subject topics and re-test.")
    if "LOW_ASSIGNMENT_COMPLETION" in concern_flags or "LOW_ASSIGNMENT_QUALITY" in concern_flags:
        action_plan.append("Use assignment tracker with due-date reminders and structured feedback.")
    if "LOW_ASSESSMENT_PERFORMANCE" in concern_flags or "ASSESSMENT_DISCIPLINE_RISK" in concern_flags:
        action_plan.append("Conduct supervised short quizzes and practice on time-bound attempts.")
    if not action_plan:
        action_plan.append("Maintain current plan and push advanced challenge tasks for growth.")

    perf_timeline = [
        {
            "date": item.get("date"),
            "marks": _to_float(item.get("marks")),
            "assignment_score": _to_float(item.get("assignment_score")),
            "co_curricular_score": _to_float(item.get("co_curricular_score")),
        }
        for item in perf_rows[-10:]
    ]
    assessment_timeline = [
        {
            "submitted_at": item.get("submitted_at"),
            "score_percentage": _to_float(item.get("score_percentage")),
            "status": item.get("status"),
            "topic": item.get("topic"),
        }
        for item in attempts[-10:]
    ]

    open_interventions = interventions_collection.count_documents(
        {
            "class_name": class_name,
            "section": section,
            "student_username": student_username,
            "status": {"$in": ["open", "in_progress"]},
        }
    )

    return {
        "student": {
            "username": student.get("username"),
            "name": student.get("name") or student.get("username"),
            "roll_no": student.get("roll_no"),
            "class_name": class_name,
            "section": section,
        },
        "snapshot": {
            "attendance_percentage": attendance_pct,
            "average_marks": marks_avg,
            "average_assignment_score": assignment_perf_avg,
            "average_assignment_grade": avg_assignment_grade,
            "average_assessment_score": assessment_avg,
            "average_co_curricular_score": co_avg,
            "assignment_completion_rate": completion_rate,
            "assignment_on_time_rate": on_time_rate,
            "readiness_score": readiness_score,
            "momentum_score": momentum_score,
            "risk_level": _risk_level(readiness_score),
            "open_interventions": open_interventions,
        },
        "trends": {
            "marks": marks_trend,
            "attendance": attendance_trend,
            "assignment_grade": assignment_grade_trend,
            "assessment_score": assessment_trend,
        },
        "consistency": consistency,
        "concern_flags": concern_flags,
        "strengths": strengths,
        "recommended_actions": action_plan,
        "timeline": {
            "performance": perf_timeline,
            "assessments": assessment_timeline,
            "assignments": student_outcomes[-10:],
        },
    }


@router.patch("/assignments/{assignment_id}/status")
def update_teacher_assignment_status(assignment_id: str, payload: TeacherAssignmentStatusIn, user=Depends(require_teacher)):
    if not ObjectId.is_valid(assignment_id):
        raise HTTPException(status_code=400, detail="Invalid assignment id")

    doc = teacher_assignments_collection.find_one({"_id": ObjectId(assignment_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if doc.get("teacher_username") != user.get("username"):
        raise HTTPException(status_code=403, detail="Not allowed")

    update = {
        "status": payload.status,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if payload.status == "completed":
        update["completed_at"] = datetime.utcnow().isoformat()
    else:
        update["completed_at"] = None
    teacher_assignments_collection.update_one({"_id": ObjectId(assignment_id)}, {"$set": update})
    return {"message": "Assignment status updated"}


@router.get("/workboard")
def get_teacher_workboard(user=Depends(require_teacher)):
    today = date.today().isoformat()
    assigned_classes = [
        item for item in user.get("assigned_classes", [])
        if item.get("class_name") and item.get("section")
    ]

    pending_attendance = []
    students_at_risk = []

    for item in assigned_classes:
        class_name = item.get("class_name")
        section = item.get("section")

        today_doc = attendance_collection.find_one(
            {"class_name": class_name, "section": section, "date": today},
            {"_id": 0, "date": 1},
        )
        if not today_doc:
            pending_attendance.append({"class_name": class_name, "section": section, "date": today})

        students = list(
            users_collection.find(
                {"role": "student", "class_name": class_name, "section": section},
                {"_id": 0, "username": 1, "roll_no": 1, "name": 1},
            )
        )
        for student in students:
            student_id = str(student.get("roll_no") or student.get("username") or "")
            if not student_id:
                continue

            records = list(
                performance_collection.find(
                    {"student_id": student_id, "class_name": class_name, "section": section},
                    {"_id": 0, "marks": 1, "assignment_score": 1},
                )
            )
            marks_values = [float(r.get("marks", 0)) for r in records]
            assignment_values = [float(r.get("assignment_score", 0)) for r in records]
            avg_marks = round(sum(marks_values) / len(marks_values), 2) if marks_values else 0
            avg_assignment = round(sum(assignment_values) / len(assignment_values), 2) if assignment_values else 0

            attendance_docs = list(
                attendance_collection.find(
                    {"class_name": class_name, "section": section},
                    {"_id": 0, "records": 1},
                )
            )
            total = 0
            present = 0
            for doc in attendance_docs:
                for rec in doc.get("records", []):
                    rec_student = str(rec.get("student_id") or rec.get("roll_no") or "")
                    if rec_student != student_id:
                        continue
                    total += 1
                    if str(rec.get("status", "")).lower() == "present":
                        present += 1
            attendance_pct = round((present / total) * 100, 2) if total else 0

            reasons = []
            if attendance_pct < 75:
                reasons.append("LOW_ATTENDANCE")
            if avg_marks < 40:
                reasons.append("LOW_MARKS")
            if avg_assignment < 40:
                reasons.append("DISCIPLINE_RISK")

            if reasons:
                students_at_risk.append(
                    {
                        "username": student.get("username"),
                        "name": student.get("name") or student.get("username"),
                        "class_name": class_name,
                        "section": section,
                        "attendance_percentage": attendance_pct,
                        "average_marks": avg_marks,
                        "average_assignment_score": avg_assignment,
                        "reason_codes": reasons,
                        "severity": "Critical" if len(reasons) >= 3 else "At Risk" if len(reasons) == 2 else "Monitor",
                    }
                )

    open_interventions = interventions_collection.count_documents(
        {
            "teacher_username": user.get("username"),
            "status": {"$in": ["open", "in_progress"]},
        }
    )

    students_at_risk.sort(key=lambda x: (len(x.get("reason_codes", [])), -x.get("attendance_percentage", 0)))
    return {
        "date": today,
        "pending_attendance_count": len(pending_attendance),
        "pending_attendance": pending_attendance,
        "at_risk_count": len(students_at_risk),
        "students_at_risk": students_at_risk[:15],
        "open_interventions_count": open_interventions,
    }
