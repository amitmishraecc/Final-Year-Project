from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import db
from utils.roles import require_admin, require_student, require_teacher

router = APIRouter(prefix="/notices", tags=["Notices"])
notices_collection = db["notices"]


class NoticePayload(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    body: str = Field(..., min_length=2, max_length=2000)
    target_type: str = Field(..., description="all | class_section | student")
    class_name: str | None = None
    section: str | None = None
    student_username: str | None = None


def _notice_projection(doc: dict) -> dict:
    return {
        "id": str(doc.get("_id")),
        "title": doc.get("title", ""),
        "body": doc.get("body", ""),
        "target_type": doc.get("target_type", ""),
        "class_name": doc.get("class_name"),
        "section": doc.get("section"),
        "student_username": doc.get("student_username"),
        "created_by": doc.get("created_by"),
        "created_by_role": doc.get("created_by_role"),
        "created_at": doc.get("created_at"),
    }


def _notice_projection_for_student(doc: dict, username: str) -> dict:
    payload = _notice_projection(doc)
    read_by = doc.get("read_by", [])
    payload["is_read"] = username in read_by
    return payload


def _normalize_notice_payload(payload: NoticePayload) -> dict:
    target_type = payload.target_type.strip().lower()
    if target_type not in {"all", "class_section", "student"}:
        raise HTTPException(status_code=400, detail="target_type must be all, class_section, or student")

    class_name = (payload.class_name or "").strip() or None
    section = (payload.section or "").strip() or None
    student_username = (payload.student_username or "").strip() or None

    if target_type == "class_section" and (not class_name or not section):
        raise HTTPException(status_code=400, detail="class_name and section are required for class_section target")
    if target_type == "student" and not student_username:
        raise HTTPException(status_code=400, detail="student_username is required for student target")

    return {
        "title": payload.title.strip(),
        "body": payload.body.strip(),
        "target_type": target_type,
        "class_name": class_name,
        "section": section,
        "student_username": student_username,
    }


@router.post("/admin")
def create_notice_by_admin(payload: NoticePayload, user=Depends(require_admin)):
    notice = _normalize_notice_payload(payload)
    notice.update(
        {
            "created_by": user.get("username"),
            "created_by_role": "admin",
            "created_at": datetime.utcnow().isoformat(),
            "read_by": [],
        }
    )
    result = notices_collection.insert_one(notice)
    return {"message": "Notice created", "id": str(result.inserted_id)}


@router.post("/teacher")
def create_notice_by_teacher(payload: NoticePayload, user=Depends(require_teacher)):
    notice = _normalize_notice_payload(payload)

    if notice["target_type"] == "all":
        raise HTTPException(status_code=403, detail="Teacher notices cannot target all students")

    assigned_classes = user.get("assigned_classes", [])
    if notice["target_type"] == "class_section":
        allowed = any(
            item.get("class_name") == notice["class_name"] and item.get("section") == notice["section"]
            for item in assigned_classes
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Class not assigned to teacher")
    elif notice["target_type"] == "student":
        if not notice["class_name"] or not notice["section"]:
            raise HTTPException(status_code=400, detail="class_name and section are required for student target")
        allowed = any(
            item.get("class_name") == notice["class_name"] and item.get("section") == notice["section"]
            for item in assigned_classes
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Class not assigned to teacher")

    notice.update(
        {
            "created_by": user.get("username"),
            "created_by_role": "teacher",
            "created_at": datetime.utcnow().isoformat(),
            "read_by": [],
        }
    )
    result = notices_collection.insert_one(notice)
    return {"message": "Notice created", "id": str(result.inserted_id)}


@router.get("/admin")
def list_notices_admin(
    class_name: str | None = Query(default=None),
    section: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    admin=Depends(require_admin),
):
    query: dict = {}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section
    if target_type:
        query["target_type"] = target_type
    rows = list(notices_collection.find(query).sort("created_at", -1).limit(200))
    return [_notice_projection(row) for row in rows]


@router.get("/teacher")
def list_notices_teacher(user=Depends(require_teacher)):
    assigned = user.get("assigned_classes", [])
    class_section_filters = [
        {"target_type": "class_section", "class_name": item.get("class_name"), "section": item.get("section")}
        for item in assigned
        if item.get("class_name") and item.get("section")
    ]
    query = {
        "$or": [
            {"target_type": "all"},
            {"target_type": "student", "student_username": user.get("username")},
            *class_section_filters,
        ]
    }
    rows = list(notices_collection.find(query).sort("created_at", -1).limit(200))
    return [_notice_projection(row) for row in rows]


@router.get("/student")
def list_notices_student(user=Depends(require_student)):
    class_name = user.get("class_name")
    section = user.get("section")
    username = user.get("username")
    query = {
        "$or": [
            {"target_type": "all"},
            {"target_type": "class_section", "class_name": class_name, "section": section},
            {"target_type": "student", "student_username": username},
        ]
    }
    rows = list(notices_collection.find(query).sort("created_at", -1).limit(200))
    return [_notice_projection_for_student(row, username) for row in rows]


@router.post("/student/read/{notice_id}")
def mark_notice_as_read(notice_id: str, user=Depends(require_student)):
    if not ObjectId.is_valid(notice_id):
        raise HTTPException(status_code=400, detail="Invalid notice id")

    class_name = user.get("class_name")
    section = user.get("section")
    username = user.get("username")
    target_guard = {
        "$or": [
            {"target_type": "all"},
            {"target_type": "class_section", "class_name": class_name, "section": section},
            {"target_type": "student", "student_username": username},
        ]
    }
    result = notices_collection.update_one(
        {"_id": ObjectId(notice_id), **target_guard},
        {"$addToSet": {"read_by": username}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notice not found")
    return {"message": "Notice marked as read"}


@router.post("/student/read-all")
def mark_all_notices_as_read(user=Depends(require_student)):
    class_name = user.get("class_name")
    section = user.get("section")
    username = user.get("username")
    query = {
        "$or": [
            {"target_type": "all"},
            {"target_type": "class_section", "class_name": class_name, "section": section},
            {"target_type": "student", "student_username": username},
        ]
    }
    result = notices_collection.update_many(query, {"$addToSet": {"read_by": username}})
    return {"message": "All notices marked as read", "updated": result.modified_count}


@router.delete("/{notice_id}")
def delete_notice(notice_id: str, user=Depends(require_admin)):
    if not ObjectId.is_valid(notice_id):
        raise HTTPException(status_code=400, detail="Invalid notice id")
    result = notices_collection.delete_one({"_id": ObjectId(notice_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notice not found")
    return {"message": "Notice deleted"}
