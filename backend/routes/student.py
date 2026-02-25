from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from database import attendance_collection, db, users_collection
from utils.roles import require_student

router = APIRouter(prefix="/student", tags=["Student"])
assignments_collection = db["student_assignments"]


def _student_identifiers(user: dict) -> list[str]:
    identifiers = [user.get("roll_no"), user.get("username")]
    return [str(item) for item in identifiers if item]


def _history_for_student(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    pipeline = [
        {"$unwind": "$records"},
        {
            "$match": {
                "$or": [
                    {"records.student_id": {"$in": ids}},
                    {"records.roll_no": {"$in": ids}},
                ]
            }
        },
        {
            "$project": {
                "_id": 0,
                "class_name": 1,
                "section": 1,
                "date": 1,
                "status": "$records.status",
            }
        },
        {"$sort": {"date": -1}},
    ]
    return list(attendance_collection.aggregate(pipeline))


@router.get("/attendance/history")
def get_my_attendance_history(user=Depends(require_student)):
    return _history_for_student(_student_identifiers(user))


@router.get("/attendance/summary")
def get_my_attendance_summary(user=Depends(require_student)):
    history = _history_for_student(_student_identifiers(user))
    total = len(history)
    present = sum(1 for item in history if str(item.get("status", "")).lower() == "present")
    percentage = round((present / total) * 100, 2) if total else 0
    return {
        "total_classes": total,
        "present_count": present,
        "attendance_percentage": percentage,
    }


@router.get("/assignments")
def get_my_assignments(user=Depends(require_student)):
    class_name = user.get("class_name")
    section = user.get("section")
    username = user.get("username")
    if not class_name or not section or not username:
        return {"common": [], "personal": []}

    rows = list(
        assignments_collection.find(
            {
                "$or": [
                    {"assignment_type": "common", "class_name": class_name, "section": section},
                    {"assignment_type": "personal", "target_username": username},
                ]
            }
        ).sort("created_at", -1)
    )
    teacher_usernames = sorted(
        {
            str(item.get("teacher_username")).strip()
            for item in rows
            if item.get("teacher_username")
        }
    )
    teacher_name_map = {}
    if teacher_usernames:
        teachers = list(
            users_collection.find(
                {"role": "teacher", "username": {"$in": teacher_usernames}},
                {"_id": 0, "username": 1, "name": 1},
            )
        )
        teacher_name_map = {
            str(t.get("username")): (t.get("name") or t.get("username") or "")
            for t in teachers
        }

    common = []
    personal = []
    for row in rows:
        row["id"] = str(row.pop("_id"))
        teacher_username = str(row.get("teacher_username") or "")
        row["teacher_name"] = teacher_name_map.get(teacher_username, teacher_username)
        completed_usernames = row.get("completed_usernames") or []
        outcomes = row.get("student_outcomes") or []
        my_outcome = next(
            (item for item in outcomes if str(item.get("student_username") or "").strip() == username),
            {},
        )
        is_completed = False
        if row.get("assignment_type") == "common":
            is_completed = bool(my_outcome.get("is_completed", username in completed_usernames))
        elif row.get("assignment_type") == "personal":
            is_completed = bool(
                my_outcome.get("is_completed")
                if my_outcome
                else (row.get("status") == "completed" and row.get("target_username") == username)
            )
        row["is_completed"] = is_completed
        row["completed_on_time"] = my_outcome.get("completed_on_time")
        row["grade_score"] = my_outcome.get("grade_score")
        row["grade_label"] = my_outcome.get("grade_label")
        row["feedback"] = my_outcome.get("feedback", "")
        row["feedback_nlp"] = my_outcome.get("nlp_analysis", {})
        if row.get("assignment_type") == "common":
            common.append(row)
        else:
            personal.append(row)

    return {"common": common, "personal": personal}


@router.patch("/assignments/{assignment_id}/complete")
def complete_assignment(assignment_id: str, user=Depends(require_student)):
    raise HTTPException(
        status_code=403,
        detail="Students cannot change assignment completion status. Only teacher can update status.",
    )
