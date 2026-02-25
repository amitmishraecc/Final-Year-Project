from datetime import date, datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import db
from utils.security import get_current_user

router = APIRouter(prefix="/calendar", tags=["Calendar"])
calendar_events_collection = db["calendar_events"]


class CalendarEventCreateIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    description: str = Field(default="", max_length=1500)
    date: str = Field(..., description="YYYY-MM-DD")
    scope: str = Field(default="personal", description="personal | class_section | global")
    class_name: str | None = None
    section: str | None = None
    event_type: str = Field(default="reminder", description="reminder | public_holiday")


def _parse_iso_date(raw: str, field_name: str = "date") -> date:
    try:
        return datetime.strptime(str(raw), "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field_name} must be in YYYY-MM-DD format")


def _nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    delta = (weekday - first.weekday() + 7) % 7
    return first + timedelta(days=delta + (n - 1) * 7)


def _last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    current = next_month - timedelta(days=1)
    while current.weekday() != weekday:
        current -= timedelta(days=1)
    return current


def _builtin_public_holidays(year: int) -> list[dict]:
    # US-centric baseline public holidays.
    return [
        {"title": "New Year's Day", "date": date(year, 1, 1)},
        {"title": "Martin Luther King Jr. Day", "date": _nth_weekday_of_month(year, 1, 0, 3)},
        {"title": "Memorial Day", "date": _last_weekday_of_month(year, 5, 0)},
        {"title": "Independence Day", "date": date(year, 7, 4)},
        {"title": "Labor Day", "date": _nth_weekday_of_month(year, 9, 0, 1)},
        {"title": "Thanksgiving Day", "date": _nth_weekday_of_month(year, 11, 3, 4)},
        {"title": "Christmas Day", "date": date(year, 12, 25)},
    ]


def _normalize_scope_and_permissions(payload: CalendarEventCreateIn, user: dict) -> dict:
    role = (user.get("role") or "").strip().lower()
    scope = (payload.scope or "").strip().lower() or "personal"
    event_type = (payload.event_type or "").strip().lower() or "reminder"
    class_name = (payload.class_name or "").strip() or None
    section = (payload.section or "").strip() or None

    if scope not in {"personal", "class_section", "global"}:
        raise HTTPException(status_code=400, detail="scope must be personal, class_section, or global")
    if event_type not in {"reminder", "public_holiday"}:
        raise HTTPException(status_code=400, detail="event_type must be reminder or public_holiday")

    if role == "student":
        if scope != "personal":
            raise HTTPException(status_code=403, detail="Students can only create personal reminders")
        if event_type != "reminder":
            raise HTTPException(status_code=403, detail="Students can only create reminder type events")
    elif role == "teacher":
        if scope == "global":
            raise HTTPException(status_code=403, detail="Teachers cannot create global events")
        if event_type == "public_holiday":
            raise HTTPException(status_code=403, detail="Teachers cannot create public holiday events")
    elif role == "admin":
        pass
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    if scope == "class_section":
        if not class_name or not section:
            raise HTTPException(status_code=400, detail="class_name and section are required for class_section scope")
        if role == "teacher":
            assigned = user.get("assigned_classes", [])
            allowed = any(
                item.get("class_name") == class_name and item.get("section") == section
                for item in assigned
            )
            if not allowed:
                raise HTTPException(status_code=403, detail="Class-section not assigned to teacher")
    else:
        class_name = None
        section = None

    if scope == "global" and role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can create global events")
    if event_type == "public_holiday" and role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can create public holiday events")

    return {
        "scope": scope,
        "event_type": event_type,
        "class_name": class_name,
        "section": section,
    }


def _serialize_event(row: dict) -> dict:
    return {
        "id": str(row.get("_id")),
        "title": row.get("title", ""),
        "description": row.get("description", ""),
        "date": row.get("date"),
        "scope": row.get("scope", "personal"),
        "class_name": row.get("class_name"),
        "section": row.get("section"),
        "event_type": row.get("event_type", "reminder"),
        "created_by": row.get("created_by"),
        "created_by_role": row.get("created_by_role"),
        "created_at": row.get("created_at"),
        "readonly": False,
    }


def _serialize_builtin_holiday(holiday: dict) -> dict:
    holiday_date = holiday["date"]
    return {
        "id": f"builtin-{holiday_date.isoformat()}-{holiday['title'].lower().replace(' ', '-')}",
        "title": holiday["title"],
        "description": "",
        "date": holiday_date.isoformat(),
        "scope": "global",
        "class_name": None,
        "section": None,
        "event_type": "public_holiday",
        "created_by": "system",
        "created_by_role": "system",
        "created_at": None,
        "readonly": True,
    }


@router.post("/events")
def create_calendar_event(payload: CalendarEventCreateIn, user=Depends(get_current_user)):
    event_date = _parse_iso_date(payload.date, "date")
    normalized = _normalize_scope_and_permissions(payload, user)

    doc = {
        "title": payload.title.strip(),
        "description": (payload.description or "").strip(),
        "date": event_date.isoformat(),
        "scope": normalized["scope"],
        "class_name": normalized["class_name"],
        "section": normalized["section"],
        "event_type": normalized["event_type"],
        "created_by": user.get("username"),
        "created_by_role": user.get("role"),
        "created_at": datetime.utcnow().isoformat(),
    }
    result = calendar_events_collection.insert_one(doc)
    return {"message": "Calendar event created", "id": str(result.inserted_id)}


@router.get("/events")
def list_calendar_events(
    from_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    to_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    user=Depends(get_current_user),
):
    today = datetime.utcnow().date()
    start = _parse_iso_date(from_date, "from_date") if from_date else date(today.year, today.month, 1)
    if to_date:
        end = _parse_iso_date(to_date, "to_date")
    else:
        # Default range: one month window from start.
        end = start + timedelta(days=40)

    if end < start:
        raise HTTPException(status_code=400, detail="to_date must be greater than or equal to from_date")

    role = (user.get("role") or "").strip().lower()
    username = user.get("username")
    class_name = user.get("class_name")
    section = user.get("section")

    if role == "admin":
        query = {"date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}
    else:
        visibility = [
            {"scope": "global"},
            {"scope": "personal", "created_by": username},
        ]

        if role == "student" and class_name and section:
            visibility.append({"scope": "class_section", "class_name": class_name, "section": section})
        if role == "teacher":
            for item in user.get("assigned_classes", []):
                c_name = item.get("class_name")
                sec = item.get("section")
                if c_name and sec:
                    visibility.append({"scope": "class_section", "class_name": c_name, "section": sec})

        query = {
            "date": {"$gte": start.isoformat(), "$lte": end.isoformat()},
            "$or": visibility,
        }

    rows = list(calendar_events_collection.find(query).sort([("date", 1), ("created_at", -1)]).limit(800))
    items = [_serialize_event(row) for row in rows]

    years = {start.year, end.year}
    builtin_holidays = []
    for yr in years:
        for holiday in _builtin_public_holidays(yr):
            if start <= holiday["date"] <= end:
                builtin_holidays.append(_serialize_builtin_holiday(holiday))

    existing_keys = {(item["date"], item["title"].strip().lower()) for item in items}
    for holiday in builtin_holidays:
        key = (holiday["date"], holiday["title"].strip().lower())
        if key not in existing_keys:
            items.append(holiday)

    items.sort(key=lambda x: (x.get("date") or "", x.get("event_type") != "public_holiday", x.get("title") or ""))
    return items


@router.delete("/events/{event_id}")
def delete_calendar_event(event_id: str, user=Depends(get_current_user)):
    if str(event_id).startswith("builtin-"):
        raise HTTPException(status_code=400, detail="Built-in holiday events cannot be deleted")

    if not ObjectId.is_valid(event_id):
        raise HTTPException(status_code=400, detail="Invalid event id")

    row = calendar_events_collection.find_one({"_id": ObjectId(event_id)})
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")

    is_admin = (user.get("role") or "").strip().lower() == "admin"
    is_owner = row.get("created_by") == user.get("username")
    if not is_admin and not is_owner:
        raise HTTPException(status_code=403, detail="You can only delete your own calendar events")

    calendar_events_collection.delete_one({"_id": ObjectId(event_id)})
    return {"message": "Calendar event deleted"}
