import csv
from datetime import datetime
from io import StringIO
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import attendance_collection, db
from utils.roles import require_admin, require_teacher

router = APIRouter(prefix="/sheets", tags=["Google Sheets Sync"])

sheet_configs_collection = db["google_sheet_configs"]
performance_collection = db["performance_records"]


class SheetConfigIn(BaseModel):
    teacher_username: str
    class_name: str
    section: str
    sheet_url: str


def _is_assigned(user: dict, class_name: str, section: str) -> bool:
    return any(
        item.get("class_name") == class_name and item.get("section") == section
        for item in user.get("assigned_classes", [])
    )


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
    export_url = _normalize_export_url(sheet_url)
    request = Request(export_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(request, timeout=15) as response:
            content = response.read().decode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch sheet CSV: {exc}")

    reader = csv.DictReader(StringIO(content))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="Sheet CSV is empty")
    return rows


@router.post("/config")
def upsert_sheet_config(payload: SheetConfigIn, admin=Depends(require_admin)):
    sheet_configs_collection.update_one(
        {
            "teacher_username": payload.teacher_username,
            "class_name": payload.class_name,
            "section": payload.section,
        },
        {"$set": payload.model_dump()},
        upsert=True,
    )
    return {"message": "Sheet mapping saved"}


@router.get("/configs")
def list_sheet_configs(teacher_username: str | None = None, admin=Depends(require_admin)):
    query = {"teacher_username": teacher_username} if teacher_username else {}
    return list(sheet_configs_collection.find(query, {"_id": 0}))


@router.get("/my-configs")
def list_my_configs(user=Depends(require_teacher)):
    return list(
        sheet_configs_collection.find(
            {"teacher_username": user["username"]},
            {"_id": 0},
        )
    )


@router.post("/teacher/sync")
def sync_from_google_sheet(
    class_name: str = Query(...),
    section: str = Query(...),
    date: str | None = Query(None),
    user=Depends(require_teacher),
):
    if not _is_assigned(user, class_name, section):
        raise HTTPException(status_code=403, detail="Class not assigned to teacher")

    mapping = sheet_configs_collection.find_one(
        {
            "teacher_username": user["username"],
            "class_name": class_name,
            "section": section,
        },
        {"_id": 0},
    )
    if not mapping:
        raise HTTPException(status_code=404, detail="No sheet mapping found for this class")

    rows = _download_csv(mapping["sheet_url"])
    effective_date = date or datetime.utcnow().date().isoformat()

    attendance_records = []
    processed = 0
    for row in rows:
        student_id = str(row.get("student_id") or row.get("roll_no") or "").strip()
        if not student_id:
            continue

        status = str(row.get("status", "Absent")).strip().capitalize()
        status = "Present" if status == "Present" else "Absent"
        attendance_records.append({"student_id": student_id, "status": status})

        marks = float(row.get("marks", 0) or 0)
        assignment_score = float(row.get("assignment_score", 0) or 0)
        co_curricular_score = float(row.get("co_curricular_score", 0) or 0)

        performance_collection.update_one(
            {
                "class_name": class_name,
                "section": section,
                "date": effective_date,
                "student_id": student_id,
            },
            {
                "$set": {
                    "class_name": class_name,
                    "section": section,
                    "date": effective_date,
                    "student_id": student_id,
                    "marks": max(0, min(100, marks)),
                    "assignment_score": max(0, min(100, assignment_score)),
                    "co_curricular_score": max(0, min(100, co_curricular_score)),
                    "teacher_username": user["username"],
                    "updated_at": datetime.utcnow().isoformat(),
                    "source": "google_sheet",
                }
            },
            upsert=True,
        )
        processed += 1

    if not attendance_records:
        raise HTTPException(status_code=400, detail="No valid student rows found in sheet")

    attendance_collection.update_one(
        {"class_name": class_name, "section": section, "date": effective_date},
        {
            "$set": {
                "class_name": class_name,
                "section": section,
                "date": effective_date,
                "teacher_username": user["username"],
                "records": attendance_records,
                "updated_at": datetime.utcnow().isoformat(),
                "source": "google_sheet",
            }
        },
        upsert=True,
    )

    return {
        "message": "Sheet synced successfully",
        "class_name": class_name,
        "section": section,
        "date": effective_date,
        "rows_processed": processed,
    }
