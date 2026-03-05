from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import attendance_collection, db, users_collection
from utils.roles import require_admin, require_student, require_teacher

router = APIRouter(prefix="/performance", tags=["Performance"])

performance_collection = db["performance_records"]

WEIGHTS = {
    "attendance": 0.30,
    "marks": 0.40,
    "assignment": 0.20,
    "co_curricular": 0.10,
}


class PerformanceRecordIn(BaseModel):
    student_id: str = Field(..., min_length=1)
    marks: float = Field(..., ge=0, le=100)
    assignment_score: float = Field(..., ge=0, le=100)
    co_curricular_score: float = Field(..., ge=0, le=100)


class PerformanceBatchIn(BaseModel):
    class_name: str
    section: str
    date: str
    records: list[PerformanceRecordIn]


def _is_assigned(user: dict, class_name: str, section: str) -> bool:
    return any(
        item.get("class_name") == class_name and item.get("section") == section
        for item in user.get("assigned_classes", [])
    )


def _ensure_assigned(user: dict, class_name: str, section: str) -> None:
    if not _is_assigned(user, class_name, section):
        raise HTTPException(status_code=403, detail="Class not assigned to teacher")


def _grade_from_score(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "F"


def _attendance_percentage(student_id: str, class_name: str | None = None, section: str | None = None) -> float:
    query = {}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section

    docs = list(attendance_collection.find(query, {"_id": 0, "records": 1}))
    total = 0
    present = 0
    for doc in docs:
        for rec in doc.get("records", []):
            rec_student = str(rec.get("student_id") or rec.get("roll_no") or "")
            if rec_student != student_id:
                continue
            total += 1
            if str(rec.get("status", "")).lower() == "present":
                present += 1
    return round((present / total) * 100, 2) if total else 0


def _weighted_grade(attendance_pct: float, marks: float, assignment: float, co_curricular: float) -> dict:
    score = (
        attendance_pct * WEIGHTS["attendance"]
        + marks * WEIGHTS["marks"]
        + assignment * WEIGHTS["assignment"]
        + co_curricular * WEIGHTS["co_curricular"]
    )
    score = round(score, 2)
    return {"weighted_score": score, "grade": _grade_from_score(score)}


def _student_summary(student: dict, class_name: str, section: str) -> dict | None:
    student_id = str(student.get("roll_no") or student.get("username") or "")
    if not student_id:
        return None

    records = list(
        performance_collection.find(
            {"student_id": student_id, "class_name": class_name, "section": section},
            {"_id": 0, "marks": 1, "assignment_score": 1, "co_curricular_score": 1},
        )
    )
    count = len(records)
    avg_marks = round(sum(float(r.get("marks", 0)) for r in records) / count, 2) if count else 0.0
    avg_assignment = (
        round(sum(float(r.get("assignment_score", 0)) for r in records) / count, 2) if count else 0.0
    )
    avg_co_curricular = (
        round(sum(float(r.get("co_curricular_score", 0)) for r in records) / count, 2) if count else 0.0
    )
    attendance_pct = _attendance_percentage(student_id, class_name, section)
    weighted = _weighted_grade(attendance_pct, avg_marks, avg_assignment, avg_co_curricular)

    return {
        "student_id": student_id,
        "username": student.get("username", ""),
        "name": student.get("name") or student.get("username", ""),
        "attendance_percentage": attendance_pct,
        "average_marks": avg_marks,
        "average_assignment_score": avg_assignment,
        "average_co_curricular_score": avg_co_curricular,
        "weighted_score": weighted["weighted_score"],
        "grade": weighted["grade"],
    }


@router.post("/teacher/records")
def upsert_performance_records(payload: PerformanceBatchIn, user=Depends(require_teacher)):
    _ensure_assigned(user, payload.class_name, payload.section)
    if not payload.records:
        raise HTTPException(status_code=400, detail="Performance records are required")

    for rec in payload.records:
        performance_collection.update_one(
            {
                "class_name": payload.class_name,
                "section": payload.section,
                "date": payload.date,
                "student_id": rec.student_id,
            },
            {
                "$set": {
                    "class_name": payload.class_name,
                    "section": payload.section,
                    "date": payload.date,
                    "student_id": rec.student_id,
                    "marks": rec.marks,
                    "assignment_score": rec.assignment_score,
                    "co_curricular_score": rec.co_curricular_score,
                    "teacher_username": user["username"],
                    "updated_at": datetime.utcnow().isoformat(),
                }
            },
            upsert=True,
        )

    return {"message": "Performance records saved"}


@router.get("/teacher/records")
def get_performance_records(
    class_name: str = Query(...),
    section: str = Query(...),
    date: str = Query(...),
    user=Depends(require_teacher),
):
    _ensure_assigned(user, class_name, section)
    docs = list(
        performance_collection.find(
            {"class_name": class_name, "section": section, "date": date},
            {"_id": 0},
        )
    )
    return docs


@router.get("/student/overview")
def get_student_overview(user=Depends(require_student)):
    student_id = str(user.get("roll_no") or user.get("username") or "")
    if not student_id:
        raise HTTPException(status_code=400, detail="Student identifier missing")

    class_name = user.get("class_name")
    section = user.get("section")

    records = list(
        performance_collection.find({"student_id": student_id}, {"_id": 0})
    )
    if class_name and section:
        records = [
            rec
            for rec in records
            if rec.get("class_name") == class_name and rec.get("section") == section
        ]

    count = len(records)
    avg_marks = round(sum(float(r.get("marks", 0)) for r in records) / count, 2) if count else 0
    avg_assignment = round(
        sum(float(r.get("assignment_score", 0)) for r in records) / count, 2
    ) if count else 0
    avg_co_curricular = round(
        sum(float(r.get("co_curricular_score", 0)) for r in records) / count, 2
    ) if count else 0
    attendance_pct = _attendance_percentage(student_id, class_name, section)

    grade = _weighted_grade(attendance_pct, avg_marks, avg_assignment, avg_co_curricular)

    return {
        "student_id": student_id,
        "class_name": class_name,
        "section": section,
        "attendance_percentage": attendance_pct,
        "average_marks": avg_marks,
        "average_assignment_score": avg_assignment,
        "average_co_curricular_score": avg_co_curricular,
        "weighted_score": grade["weighted_score"],
        "grade": grade["grade"],
        "records_count": count,
    }


@router.get("/admin/class-report")
def get_class_report(class_name: str, section: str, admin=Depends(require_admin)):
    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "password": 0},
        )
    )

    report = []
    for student in students:
        student_id = str(student.get("roll_no") or student.get("username") or "")
        if not student_id:
            continue
        records = list(
            performance_collection.find(
                {"student_id": student_id, "class_name": class_name, "section": section},
                {"_id": 0},
            )
        )
        count = len(records)
        avg_marks = round(sum(float(r.get("marks", 0)) for r in records) / count, 2) if count else 0
        avg_assignment = round(
            sum(float(r.get("assignment_score", 0)) for r in records) / count, 2
        ) if count else 0
        avg_co_curricular = round(
            sum(float(r.get("co_curricular_score", 0)) for r in records) / count, 2
        ) if count else 0
        attendance_pct = _attendance_percentage(student_id, class_name, section)
        weighted = _weighted_grade(attendance_pct, avg_marks, avg_assignment, avg_co_curricular)

        report.append(
            {
                "student_id": student_id,
                "username": student.get("username", ""),
                "attendance_percentage": attendance_pct,
                "average_marks": avg_marks,
                "average_assignment_score": avg_assignment,
                "average_co_curricular_score": avg_co_curricular,
                "weighted_score": weighted["weighted_score"],
                "grade": weighted["grade"],
            }
        )

    report.sort(key=lambda x: x["weighted_score"], reverse=True)
    return {
        "class_name": class_name,
        "section": section,
        "student_count": len(report),
        "students": report,
    }


@router.get("/student/self-analytics")
def get_student_self_analytics(user=Depends(require_student)):
    class_name = str(user.get("class_name") or "")
    section = str(user.get("section") or "")
    if not class_name or not section:
        raise HTTPException(status_code=400, detail="Student class/section missing")

    my_student_id = str(user.get("roll_no") or user.get("username") or "")
    if not my_student_id:
        raise HTTPException(status_code=400, detail="Student identifier missing")

    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "username": 1, "roll_no": 1, "name": 1},
        )
    )
    summaries = []
    for student in students:
        row = _student_summary(student, class_name, section)
        if row:
            summaries.append(row)
    if not summaries:
        return {
            "class_name": class_name,
            "section": section,
            "student_count": 0,
            "my_metrics": {},
            "class_average": {},
            "topper_benchmark": {},
            "leaderboard_top_3": [],
            "comparison": {},
        }

    summaries.sort(key=lambda x: x["weighted_score"], reverse=True)
    my_row = next((row for row in summaries if row["student_id"] == my_student_id), None)
    if not my_row:
        my_row = _student_summary(
            {"username": user.get("username"), "roll_no": user.get("roll_no"), "name": user.get("name")},
            class_name,
            section,
        ) or {}

    student_count = len(summaries)
    class_average = {
        "attendance_percentage": round(sum(x["attendance_percentage"] for x in summaries) / student_count, 2),
        "average_marks": round(sum(x["average_marks"] for x in summaries) / student_count, 2),
        "average_assignment_score": round(sum(x["average_assignment_score"] for x in summaries) / student_count, 2),
        "average_co_curricular_score": round(
            sum(x["average_co_curricular_score"] for x in summaries) / student_count, 2
        ),
        "weighted_score": round(sum(x["weighted_score"] for x in summaries) / student_count, 2),
    }
    topper = summaries[0]
    leaderboard = []
    for idx, row in enumerate(summaries[:3]):
        leaderboard.append(
            {
                "rank": idx + 1,
                "name": row.get("name"),
                "username": row.get("username"),
                "weighted_score": row.get("weighted_score"),
                "grade": row.get("grade"),
                "attendance_percentage": row.get("attendance_percentage"),
                "average_marks": row.get("average_marks"),
            }
        )

    my_rank = next((idx + 1 for idx, row in enumerate(summaries) if row["student_id"] == my_student_id), None)
    my_weighted = float(my_row.get("weighted_score", 0))
    comparison = {
        "my_rank": my_rank,
        "vs_class_average": {
            "weighted_score_delta": round(my_weighted - class_average["weighted_score"], 2),
            "marks_delta": round(float(my_row.get("average_marks", 0)) - class_average["average_marks"], 2),
            "attendance_delta": round(
                float(my_row.get("attendance_percentage", 0)) - class_average["attendance_percentage"], 2
            ),
        },
        "vs_topper": {
            "weighted_score_gap": round(float(topper["weighted_score"]) - my_weighted, 2),
            "marks_gap": round(float(topper["average_marks"]) - float(my_row.get("average_marks", 0)), 2),
            "attendance_gap": round(
                float(topper["attendance_percentage"]) - float(my_row.get("attendance_percentage", 0)), 2
            ),
        },
    }

    return {
        "class_name": class_name,
        "section": section,
        "student_count": student_count,
        "my_metrics": my_row,
        "class_average": class_average,
        "topper_benchmark": {
            "name": topper.get("name"),
            "username": topper.get("username"),
            "weighted_score": topper.get("weighted_score"),
            "grade": topper.get("grade"),
            "average_marks": topper.get("average_marks"),
            "attendance_percentage": topper.get("attendance_percentage"),
        },
        "leaderboard_top_3": leaderboard,
        "comparison": comparison,
    }
