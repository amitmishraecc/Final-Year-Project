from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import attendance_collection, db, users_collection
from utils.roles import require_admin, require_teacher

router = APIRouter(prefix="/interventions", tags=["Interventions"])

performance_collection = db["performance_records"]
interventions_collection = db["interventions"]


class InterventionStatusIn(BaseModel):
    status: str = Field(..., pattern="^(open|in_progress|resolved|closed)$")
    note: str | None = None


def _teacher_assigned(user: dict, class_name: str, section: str) -> bool:
    return any(
        item.get("class_name") == class_name and item.get("section") == section
        for item in user.get("assigned_classes", [])
    )


def _student_risk(student: dict, class_name: str, section: str) -> dict | None:
    student_id = str(student.get("roll_no") or student.get("username") or "")
    if not student_id:
        return None

    rows = list(
        performance_collection.find(
            {"student_id": student_id, "class_name": class_name, "section": section},
            {"_id": 0, "marks": 1, "assignment_score": 1},
        )
    )
    marks = [float(r.get("marks", 0)) for r in rows]
    assignments = [float(r.get("assignment_score", 0)) for r in rows]
    avg_marks = round(sum(marks) / len(marks), 2) if marks else 0
    avg_assignment = round(sum(assignments) / len(assignments), 2) if assignments else 0

    attendance_docs = list(
        attendance_collection.find({"class_name": class_name, "section": section}, {"_id": 0, "records": 1})
    )
    total = 0
    present = 0
    for doc in attendance_docs:
        for rec in doc.get("records", []):
            rec_id = str(rec.get("student_id") or rec.get("roll_no") or "")
            if rec_id != student_id:
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

    if not reasons:
        return None
    severity = "critical" if len(reasons) >= 3 else "at_risk" if len(reasons) == 2 else "monitor"
    return {
        "student_id": student_id,
        "username": student.get("username"),
        "name": student.get("name") or student.get("username"),
        "class_name": class_name,
        "section": section,
        "attendance_percentage": attendance_pct,
        "average_marks": avg_marks,
        "average_assignment_score": avg_assignment,
        "reason_codes": reasons,
        "severity": severity,
    }


@router.post("/teacher/auto-create")
def auto_create_interventions(
    class_name: str = Query(...),
    section: str = Query(...),
    top_n: int = Query(10, ge=1, le=50),
    teacher=Depends(require_teacher),
):
    if not _teacher_assigned(teacher, class_name, section):
        raise HTTPException(status_code=403, detail="Class/section not assigned to teacher")

    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "username": 1, "roll_no": 1, "name": 1},
        )
    )
    risk_rows = []
    for student in students:
        risk = _student_risk(student, class_name, section)
        if risk:
            risk_rows.append(risk)
    risk_rows.sort(key=lambda r: (len(r["reason_codes"]), -r["attendance_percentage"]), reverse=True)
    selected = risk_rows[:top_n]

    created = 0
    skipped = 0
    for row in selected:
        exists = interventions_collection.find_one(
            {
                "username": row["username"],
                "class_name": row["class_name"],
                "section": row["section"],
                "status": {"$in": ["open", "in_progress"]},
            },
            {"_id": 1},
        )
        if exists:
            skipped += 1
            continue
        interventions_collection.insert_one(
            {
                **row,
                "status": "open",
                "teacher_username": teacher.get("username"),
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
                "notes": [],
                "escalated": row["severity"] == "critical",
            }
        )
        created += 1

    return {"message": "Interventions processed", "created": created, "skipped": skipped}


@router.get("/teacher")
def list_teacher_interventions(
    status: str | None = Query(None),
    teacher=Depends(require_teacher),
):
    query = {"teacher_username": teacher.get("username")}
    if status:
        query["status"] = status
    rows = list(interventions_collection.find(query).sort("updated_at", -1))
    for row in rows:
        row["id"] = str(row["_id"])
        row.pop("_id", None)
    return rows


@router.patch("/teacher/{intervention_id}/status")
def update_teacher_intervention_status(
    intervention_id: str,
    payload: InterventionStatusIn,
    teacher=Depends(require_teacher),
):
    if not ObjectId.is_valid(intervention_id):
        raise HTTPException(status_code=400, detail="Invalid intervention id")
    doc = interventions_collection.find_one({"_id": ObjectId(intervention_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Intervention not found")
    if doc.get("teacher_username") != teacher.get("username"):
        raise HTTPException(status_code=403, detail="Not allowed")

    update = {"status": payload.status, "updated_at": datetime.utcnow().isoformat()}
    note = (payload.note or "").strip()
    if note:
        interventions_collection.update_one(
            {"_id": ObjectId(intervention_id)},
            {
                "$set": update,
                "$push": {
                    "notes": {
                        "by": teacher.get("username"),
                        "text": note,
                        "at": datetime.utcnow().isoformat(),
                    }
                },
            },
        )
    else:
        interventions_collection.update_one({"_id": ObjectId(intervention_id)}, {"$set": update})
    return {"message": "Intervention updated"}


@router.get("/admin")
def list_admin_interventions(
    status: str | None = Query(None),
    severity: str | None = Query(None),
    escalated_only: bool = Query(False),
    admin=Depends(require_admin),
):
    query = {}
    if status:
        query["status"] = status
    if severity:
        query["severity"] = severity
    if escalated_only:
        query["escalated"] = True
    rows = list(interventions_collection.find(query).sort("updated_at", -1).limit(300))
    for row in rows:
        row["id"] = str(row["_id"])
        row.pop("_id", None)
    return rows


@router.patch("/admin/{intervention_id}/escalate")
def escalate_intervention(intervention_id: str, admin=Depends(require_admin)):
    if not ObjectId.is_valid(intervention_id):
        raise HTTPException(status_code=400, detail="Invalid intervention id")
    result = interventions_collection.update_one(
        {"_id": ObjectId(intervention_id)},
        {"$set": {"escalated": True, "updated_at": datetime.utcnow().isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return {"message": "Intervention escalated"}
