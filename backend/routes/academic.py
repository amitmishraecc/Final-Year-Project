import csv
from datetime import datetime
from io import StringIO
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import attendance_collection, db, users_collection
from utils.roles import require_admin, require_student, require_teacher
from utils.security import hash_password

router = APIRouter(prefix="/academic", tags=["Academic Management"])

class_sections_collection = db["class_sections"]
subject_assignments_collection = db["subject_teacher_assignments"]
subject_marks_collection = db["subject_marks"]
subject_attendance_collection = db["subject_attendance"]
timetable_collection = db["timetable_entries"]
period_attendance_collection = db["period_attendance"]


class SubjectIn(BaseModel):
    subject_code: str
    subject_name: str
    subject_type: str = Field(pattern="^(theory|practical)$")
    max_marks: float = Field(default=100, gt=0)


class ClassSectionIn(BaseModel):
    class_name: str
    section: str
    program: str | None = None
    semester: int | None = None


class TeacherAssignmentIn(BaseModel):
    teacher_username: str
    class_name: str
    section: str
    subject_code: str


class StudentAttendanceRecordIn(BaseModel):
    student_id: str
    status: str = Field(pattern="^(Present|Absent|present|absent)$")


class SubjectAttendanceIn(BaseModel):
    class_name: str
    section: str
    subject_code: str
    date: str
    records: list[StudentAttendanceRecordIn]


class SubjectMarkRecordIn(BaseModel):
    student_id: str
    obtained_marks: float = Field(ge=0)


class SubjectMarksIn(BaseModel):
    class_name: str
    section: str
    subject_code: str
    exam_name: str
    date: str
    records: list[SubjectMarkRecordIn]


class TimetableEntryIn(BaseModel):
    class_name: str
    section: str
    day_of_week: str  # Monday..Sunday
    period_no: int = Field(ge=1, le=12)
    start_time: str | None = None
    end_time: str | None = None
    subject_code: str
    teacher_username: str


class PeriodAttendanceIn(BaseModel):
    class_name: str
    section: str
    subject_code: str
    period_no: int = Field(ge=1, le=12)
    date: str
    records: list[StudentAttendanceRecordIn]


def _normalize_export_url(sheet_url: str) -> str:
    parsed = urlparse(sheet_url)
    if "docs.google.com" not in parsed.netloc:
        raise HTTPException(status_code=400, detail="Only Google Sheets URL is supported")

    if "/export" in parsed.path and "format=csv" in parsed.query:
        return sheet_url

    path = parsed.path
    if "/edit" in path:
        path = path.split("/edit")[0] + "/export"
    elif not path.endswith("/export"):
        if path.endswith("/"):
            path = f"{path}export"
        else:
            path = f"{path}/export"

    query = parse_qs(parsed.query)
    gid = query.get("gid", ["0"])[0]
    return f"https://docs.google.com{path}?format=csv&gid={gid}"


def _download_csv(sheet_url: str) -> list[dict]:
    request = Request(_normalize_export_url(sheet_url), headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(request, timeout=20) as response:
            content = response.read().decode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch sheet CSV: {exc}")
    rows = list(csv.DictReader(StringIO(content)))
    if not rows:
        raise HTTPException(status_code=400, detail="Sheet CSV is empty")
    return rows


def _is_teacher_assigned_subject(user: dict, class_name: str, section: str, subject_code: str) -> bool:
    assignment = subject_assignments_collection.find_one(
        {
            "teacher_username": user["username"],
            "class_name": class_name,
            "section": section,
            "subject_code": subject_code,
        }
    )
    return assignment is not None


def _normalized_day(day: str) -> str:
    return day.strip().capitalize()


@router.post("/admin/class-sections")
def upsert_class_section(payload: ClassSectionIn, admin=Depends(require_admin)):
    class_sections_collection.update_one(
        {"class_name": payload.class_name, "section": payload.section},
        {
            "$set": {
                "class_name": payload.class_name,
                "section": payload.section,
                "program": payload.program or payload.class_name,
                "semester": payload.semester,
            },
            "$setOnInsert": {"subjects": []},
        },
        upsert=True,
    )
    return {"message": "Class section saved"}


@router.get("/admin/class-sections")
def list_class_sections(admin=Depends(require_admin)):
    return list(class_sections_collection.find({}, {"_id": 0}).sort([("class_name", 1), ("section", 1)]))


@router.post("/admin/subjects")
def add_or_update_subject(
    class_name: str = Query(...),
    section: str = Query(...),
    payload: SubjectIn | None = None,
    admin=Depends(require_admin),
):
    if payload is None:
        raise HTTPException(status_code=400, detail="Subject payload required")

    class_doc = class_sections_collection.find_one({"class_name": class_name, "section": section}, {"_id": 0})
    if not class_doc:
        class_sections_collection.insert_one(
            {"class_name": class_name, "section": section, "program": class_name, "subjects": []}
        )
        class_doc = {"class_name": class_name, "section": section, "subjects": []}

    subjects = class_doc.get("subjects", [])
    updated = False
    for idx, subject in enumerate(subjects):
        if subject.get("subject_code") == payload.subject_code:
            subjects[idx] = payload.model_dump()
            updated = True
            break
    if not updated:
        subjects.append(payload.model_dump())

    class_sections_collection.update_one(
        {"class_name": class_name, "section": section},
        {"$set": {"subjects": subjects}},
        upsert=True,
    )
    return {"message": "Subject saved"}


@router.get("/admin/subjects")
def list_subjects(class_name: str, section: str, admin=Depends(require_admin)):
    class_doc = class_sections_collection.find_one(
        {"class_name": class_name, "section": section},
        {"_id": 0, "subjects": 1},
    )
    return class_doc.get("subjects", []) if class_doc else []


@router.post("/admin/assign-subject")
def assign_teacher_to_subject(payload: TeacherAssignmentIn, admin=Depends(require_admin)):
    teacher = users_collection.find_one({"username": payload.teacher_username, "role": "teacher"})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    class_doc = class_sections_collection.find_one(
        {"class_name": payload.class_name, "section": payload.section},
        {"_id": 0},
    )
    if not class_doc:
        raise HTTPException(status_code=404, detail="Class section not found")

    subject = next(
        (item for item in class_doc.get("subjects", []) if item.get("subject_code") == payload.subject_code),
        None,
    )
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found in class section")

    subject_assignments_collection.update_one(
        {
            "teacher_username": payload.teacher_username,
            "class_name": payload.class_name,
            "section": payload.section,
            "subject_code": payload.subject_code,
        },
        {
            "$set": {
                "teacher_username": payload.teacher_username,
                "class_name": payload.class_name,
                "section": payload.section,
                "subject_code": payload.subject_code,
                "subject_name": subject["subject_name"],
                "subject_type": subject["subject_type"],
                "max_marks": subject["max_marks"],
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
        upsert=True,
    )

    users_collection.update_one(
        {"username": payload.teacher_username},
        {"$addToSet": {"assigned_classes": {"class_name": payload.class_name, "section": payload.section}}},
    )

    return {"message": "Teacher assigned to subject"}


@router.get("/admin/subject-assignments")
def list_subject_assignments(
    class_name: str | None = None,
    section: str | None = None,
    teacher_username: str | None = None,
    admin=Depends(require_admin),
):
    query = {}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section
    if teacher_username:
        query["teacher_username"] = teacher_username
    return list(subject_assignments_collection.find(query, {"_id": 0}))


@router.post("/admin/timetable")
def upsert_timetable_entry(payload: TimetableEntryIn, admin=Depends(require_admin)):
    day = _normalized_day(payload.day_of_week)
    if day not in {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}:
        raise HTTPException(status_code=400, detail="Invalid day_of_week")

    assignment = subject_assignments_collection.find_one(
        {
            "teacher_username": payload.teacher_username,
            "class_name": payload.class_name,
            "section": payload.section,
            "subject_code": payload.subject_code,
        },
        {"_id": 0},
    )
    if not assignment:
        raise HTTPException(status_code=400, detail="Teacher is not assigned to this subject/class/section")

    timetable_collection.update_one(
        {
            "class_name": payload.class_name,
            "section": payload.section,
            "day_of_week": day,
            "period_no": payload.period_no,
        },
        {
            "$set": {
                "class_name": payload.class_name,
                "section": payload.section,
                "day_of_week": day,
                "period_no": payload.period_no,
                "start_time": payload.start_time,
                "end_time": payload.end_time,
                "subject_code": payload.subject_code,
                "teacher_username": payload.teacher_username,
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
        upsert=True,
    )
    return {"message": "Timetable entry saved"}


@router.get("/admin/timetable")
def list_timetable_entries(
    class_name: str,
    section: str,
    day_of_week: str | None = None,
    admin=Depends(require_admin),
):
    query = {"class_name": class_name, "section": section}
    if day_of_week:
        query["day_of_week"] = _normalized_day(day_of_week)
    return list(
        timetable_collection.find(query, {"_id": 0}).sort([("day_of_week", 1), ("period_no", 1)])
    )


@router.post("/admin/import-students/google-sheet")
def import_students_from_google_sheet(
    class_name: str = Query(...),
    section: str = Query(...),
    sheet_url: str = Query(...),
    default_password: str = Query("pass123"),
    admin=Depends(require_admin),
):
    rows = _download_csv(sheet_url)
    created = 0
    updated = 0

    for row in rows:
        roll_no = str(row.get("roll_no") or row.get("student_id") or "").strip()
        name = str(row.get("name") or "").strip()
        username = str(row.get("username") or "").strip() or roll_no.lower()
        if not roll_no or not username:
            continue

        payload = {
            "username": username,
            "role": "student",
            "roll_no": roll_no,
            "name": name or username,
            "class_name": class_name,
            "section": section,
        }

        existing = users_collection.find_one({"username": username})
        if existing:
            users_collection.update_one({"username": username}, {"$set": payload})
            updated += 1
        else:
            users_collection.insert_one(
                {
                    **payload,
                    "password": hash_password(str(row.get("password") or default_password)),
                }
            )
            created += 1

    return {"message": "Students imported", "created": created, "updated": updated}


@router.get("/teacher/subject-assignments")
def get_my_subject_assignments(user=Depends(require_teacher)):
    return list(
        subject_assignments_collection.find(
            {"teacher_username": user["username"]},
            {"_id": 0},
        )
    )


@router.get("/teacher/timetable")
def get_my_timetable(
    class_name: str | None = None,
    section: str | None = None,
    day_of_week: str | None = None,
    user=Depends(require_teacher),
):
    query = {"teacher_username": user["username"]}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section
    if day_of_week:
        query["day_of_week"] = _normalized_day(day_of_week)
    return list(
        timetable_collection.find(query, {"_id": 0}).sort([("day_of_week", 1), ("period_no", 1)])
    )


@router.get("/teacher/students")
def get_subject_students(class_name: str, section: str, subject_code: str, user=Depends(require_teacher)):
    if not _is_teacher_assigned_subject(user, class_name, section, subject_code):
        raise HTTPException(status_code=403, detail="Not assigned to this subject for class section")

    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "password": 0},
        )
    )
    return [
        {
            "student_id": str(item.get("roll_no") or item.get("username") or ""),
            "roll_no": item.get("roll_no", ""),
            "name": item.get("name") or item.get("username", ""),
            "username": item.get("username", ""),
        }
        for item in students
        if item.get("roll_no") or item.get("username")
    ]


@router.post("/teacher/subject-attendance")
def mark_subject_attendance(payload: SubjectAttendanceIn, user=Depends(require_teacher)):
    if not _is_teacher_assigned_subject(user, payload.class_name, payload.section, payload.subject_code):
        raise HTTPException(status_code=403, detail="Not assigned to this subject for class section")

    records = [
        {"student_id": item.student_id, "status": item.status.capitalize()}
        for item in payload.records
    ]
    subject_attendance_collection.update_one(
        {
            "class_name": payload.class_name,
            "section": payload.section,
            "subject_code": payload.subject_code,
            "date": payload.date,
        },
        {
            "$set": {
                "class_name": payload.class_name,
                "section": payload.section,
                "subject_code": payload.subject_code,
                "date": payload.date,
                "teacher_username": user["username"],
                "records": records,
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
        upsert=True,
    )
    return {"message": "Subject attendance saved"}


@router.post("/teacher/period-attendance")
def mark_period_attendance(payload: PeriodAttendanceIn, user=Depends(require_teacher)):
    if not _is_teacher_assigned_subject(user, payload.class_name, payload.section, payload.subject_code):
        raise HTTPException(status_code=403, detail="Not assigned to this subject for class section")

    timetable = timetable_collection.find_one(
        {
            "teacher_username": user["username"],
            "class_name": payload.class_name,
            "section": payload.section,
            "subject_code": payload.subject_code,
            "period_no": payload.period_no,
        },
        {"_id": 0},
    )
    if not timetable:
        raise HTTPException(status_code=400, detail="No timetable entry found for this period")

    records = [
        {"student_id": item.student_id, "status": item.status.capitalize()}
        for item in payload.records
    ]
    period_attendance_collection.update_one(
        {
            "class_name": payload.class_name,
            "section": payload.section,
            "subject_code": payload.subject_code,
            "period_no": payload.period_no,
            "date": payload.date,
        },
        {
            "$set": {
                "class_name": payload.class_name,
                "section": payload.section,
                "subject_code": payload.subject_code,
                "period_no": payload.period_no,
                "date": payload.date,
                "teacher_username": user["username"],
                "records": records,
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
        upsert=True,
    )

    # Keep daily attendance in sync for student dashboard/analytics:
    # mark Present if student was present in any saved period of that day.
    day_period_docs = list(
        period_attendance_collection.find(
            {
                "class_name": payload.class_name,
                "section": payload.section,
                "date": payload.date,
            },
            {"_id": 0, "records": 1},
        )
    )
    presence_map = {}
    for doc in day_period_docs:
        for rec in doc.get("records", []):
            sid = str(rec.get("student_id") or "").strip()
            if not sid:
                continue
            is_present = str(rec.get("status", "")).lower() == "present"
            presence_map[sid] = bool(presence_map.get(sid, False) or is_present)

    class_students = list(
        users_collection.find(
            {"role": "student", "class_name": payload.class_name, "section": payload.section},
            {"_id": 0, "roll_no": 1, "username": 1},
        )
    )
    daily_records = []
    for student in class_students:
        sid = str(student.get("roll_no") or student.get("username") or "").strip()
        if not sid:
            continue
        daily_records.append(
            {
                "student_id": sid,
                "status": "Present" if presence_map.get(sid, False) else "Absent",
            }
        )

    attendance_collection.update_one(
        {"class_name": payload.class_name, "section": payload.section, "date": payload.date},
        {
            "$set": {
                "class_name": payload.class_name,
                "section": payload.section,
                "date": payload.date,
                "teacher_username": user["username"],
                "records": daily_records,
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
        upsert=True,
    )
    return {"message": "Period attendance saved"}


@router.get("/teacher/period-attendance")
def get_period_attendance(
    class_name: str,
    section: str,
    subject_code: str,
    period_no: int,
    date: str,
    user=Depends(require_teacher),
):
    if not _is_teacher_assigned_subject(user, class_name, section, subject_code):
        raise HTTPException(status_code=403, detail="Not assigned to this subject for class section")
    doc = period_attendance_collection.find_one(
        {
            "class_name": class_name,
            "section": section,
            "subject_code": subject_code,
            "period_no": period_no,
            "date": date,
        },
        {"_id": 0},
    )
    return doc or {
        "class_name": class_name,
        "section": section,
        "subject_code": subject_code,
        "period_no": period_no,
        "date": date,
        "records": [],
    }


@router.post("/teacher/subject-marks")
def submit_subject_marks(payload: SubjectMarksIn, user=Depends(require_teacher)):
    assignment = subject_assignments_collection.find_one(
        {
            "teacher_username": user["username"],
            "class_name": payload.class_name,
            "section": payload.section,
            "subject_code": payload.subject_code,
        },
        {"_id": 0},
    )
    if not assignment:
        raise HTTPException(status_code=403, detail="Not assigned to this subject for class section")

    max_marks = float(assignment.get("max_marks", 100))
    for record in payload.records:
        if record.obtained_marks > max_marks:
            raise HTTPException(
                status_code=400,
                detail=f"Obtained marks cannot exceed max marks ({max_marks}) for subject {payload.subject_code}",
            )
        subject_marks_collection.update_one(
            {
                "class_name": payload.class_name,
                "section": payload.section,
                "subject_code": payload.subject_code,
                "exam_name": payload.exam_name,
                "date": payload.date,
                "student_id": record.student_id,
            },
            {
                "$set": {
                    "class_name": payload.class_name,
                    "section": payload.section,
                    "subject_code": payload.subject_code,
                    "exam_name": payload.exam_name,
                    "date": payload.date,
                    "student_id": record.student_id,
                    "obtained_marks": record.obtained_marks,
                    "max_marks": max_marks,
                    "teacher_username": user["username"],
                    "updated_at": datetime.utcnow().isoformat(),
                }
            },
            upsert=True,
        )
    return {"message": "Subject marks saved"}


@router.get("/admin/class-overview")
def get_class_overview(class_name: str, section: str, admin=Depends(require_admin)):
    class_doc = class_sections_collection.find_one(
        {"class_name": class_name, "section": section},
        {"_id": 0},
    ) or {"class_name": class_name, "section": section, "subjects": []}

    students_count = users_collection.count_documents(
        {"role": "student", "class_name": class_name, "section": section}
    )
    assignments = list(
        subject_assignments_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0},
        )
    )
    marks = list(
        subject_marks_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0},
        )
    )

    subject_stats = {}
    for mark in marks:
        code = mark.get("subject_code")
        if not code:
            continue
        stat = subject_stats.setdefault(code, {"subject_code": code, "obtained_total": 0.0, "max_total": 0.0, "entries": 0})
        stat["obtained_total"] += float(mark.get("obtained_marks", 0))
        stat["max_total"] += float(mark.get("max_marks", 0))
        stat["entries"] += 1

    subjects_view = []
    for subj in class_doc.get("subjects", []):
        code = subj.get("subject_code")
        stat = subject_stats.get(code, {"obtained_total": 0.0, "max_total": 0.0, "entries": 0})
        percentage = round((stat["obtained_total"] / stat["max_total"]) * 100, 2) if stat["max_total"] else 0
        teacher = next((item["teacher_username"] for item in assignments if item.get("subject_code") == code), None)
        subjects_view.append(
            {
                **subj,
                "teacher_username": teacher,
                "average_percentage": percentage,
                "entries": stat["entries"],
            }
        )

    return {
        "class_name": class_name,
        "section": section,
        "students_count": students_count,
        "subjects_count": len(class_doc.get("subjects", [])),
        "subjects": subjects_view,
        "assignments": assignments,
    }


@router.get("/student/subject-overview")
def get_student_subject_overview(student=Depends(require_student)):
    student_id = str(student.get("roll_no") or student.get("username") or "").strip()
    class_name = str(student.get("class_name") or "").strip()
    section = str(student.get("section") or "").strip()

    if not student_id or not class_name or not section:
        raise HTTPException(status_code=400, detail="Student class/section/profile is incomplete")

    class_doc = class_sections_collection.find_one(
        {"class_name": class_name, "section": section},
        {"_id": 0},
    ) or {"subjects": []}

    subject_assignments = list(
        subject_assignments_collection.find(
            {"class_name": class_name, "section": section},
            {"_id": 0},
        )
    )

    subject_rows = []
    for subject in class_doc.get("subjects", []):
        subject_code = subject.get("subject_code")
        if not subject_code:
            continue

        assignment = next(
            (item for item in subject_assignments if item.get("subject_code") == subject_code),
            {},
        )

        marks = list(
            subject_marks_collection.find(
                {
                    "class_name": class_name,
                    "section": section,
                    "subject_code": subject_code,
                    "student_id": student_id,
                },
                {"_id": 0},
            )
        )
        marks_entries = len(marks)
        marks_obtained_total = sum(float(item.get("obtained_marks", 0)) for item in marks)
        marks_max_total = sum(float(item.get("max_marks", subject.get("max_marks", 100))) for item in marks)
        marks_percentage = round((marks_obtained_total / marks_max_total) * 100, 2) if marks_max_total else 0

        attendance_docs = list(
            subject_attendance_collection.find(
                {
                    "class_name": class_name,
                    "section": section,
                    "subject_code": subject_code,
                },
                {"_id": 0, "records": 1},
            )
        )
        total_sessions = 0
        present_sessions = 0
        for doc in attendance_docs:
            for rec in doc.get("records", []):
                if str(rec.get("student_id", "")).strip() == student_id:
                    total_sessions += 1
                    if str(rec.get("status", "")).lower() == "present":
                        present_sessions += 1
                    break

        attendance_percentage = round((present_sessions / total_sessions) * 100, 2) if total_sessions else 0

        subject_rows.append(
            {
                "subject_code": subject_code,
                "subject_name": subject.get("subject_name", ""),
                "subject_type": subject.get("subject_type", ""),
                "max_marks": float(subject.get("max_marks", 100)),
                "teacher_username": assignment.get("teacher_username"),
                "marks_entries": marks_entries,
                "marks_percentage": marks_percentage,
                "attendance_percentage": attendance_percentage,
            }
        )

    best_subject = None
    weak_subject = None
    if subject_rows:
        best_subject = max(subject_rows, key=lambda x: x["marks_percentage"])
        weak_subject = min(subject_rows, key=lambda x: x["marks_percentage"])

    avg_subject_attendance = round(
        sum(item["attendance_percentage"] for item in subject_rows) / len(subject_rows), 2
    ) if subject_rows else 0

    return {
        "student_id": student_id,
        "class_name": class_name,
        "section": section,
        "subjects_count": len(subject_rows),
        "average_subject_attendance": avg_subject_attendance,
        "best_subject": {
            "subject_code": best_subject.get("subject_code"),
            "marks_percentage": best_subject.get("marks_percentage"),
        } if best_subject else None,
        "weak_subject": {
            "subject_code": weak_subject.get("subject_code"),
            "marks_percentage": weak_subject.get("marks_percentage"),
        } if weak_subject else None,
        "subjects": subject_rows,
    }
