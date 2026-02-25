import re
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import attendance_collection, db, users_collection
from utils.security import get_current_user

router = APIRouter(prefix="/ai", tags=["AI"])
performance_collection = db["performance_records"]

ATTENDANCE_THRESHOLD = 75.0
MARKS_THRESHOLD = 40.0
ASSIGNMENT_THRESHOLD = 40.0
MISSING_ASSIGNMENT_RATIO_THRESHOLD = 0.30
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}


class NLQueryIn(BaseModel):
    query: str = Field(..., min_length=3, max_length=1200)
    class_name: str | None = None
    section: str | None = None
    top_n: int = Field(default=5, ge=1, le=100)


def _require_admin_or_teacher(user=Depends(get_current_user)):
    role = user.get("role")
    if role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Admin or teacher access required")
    return user


def _extract_current_request(text: str) -> str:
    marker = "Current request:"
    if marker in text:
        return text.split(marker)[-1].strip()
    return text.strip()


def _normalize_query_text(text: str) -> str:
    q = _extract_current_request(text).lower()
    replacements = {
        "attendence": "attendance",
        "attandance": "attendance",
        "querry": "query",
        "studnet": "student",
        "sec ": "section ",
        "cls ": "class ",
        "totl": "total",
    }
    for wrong, right in replacements.items():
        q = q.replace(wrong, right)
    return re.sub(r"\s+", " ", q).strip()


def _extract_class_section(text: str) -> tuple[str | None, str | None]:
    normalized = _normalize_query_text(text)

    dash_match = re.search(r"\b([a-z0-9]{2,})\s*[- ]\s*([a-z])\b", normalized)
    if dash_match:
        return dash_match.group(1).upper(), dash_match.group(2).upper()

    sec_match = re.search(r"\b(?:for|in)?\s*([a-z0-9]{2,})\s+(?:section|sec)\s+([a-z])\b", normalized)
    if sec_match:
        return sec_match.group(1).upper(), sec_match.group(2).upper()

    class_match = re.search(r"\bclass\s+([a-z0-9]+)\b", normalized)
    section_match = re.search(r"\bsection\s+([a-z])\b", normalized)
    class_name = class_match.group(1).upper() if class_match else None
    section = section_match.group(1).upper() if section_match else None
    return class_name, section


def _extract_top_n(text: str, default: int = 5) -> int:
    normalized = _normalize_query_text(text)
    match = re.search(r"\b(?:top|first|show)\s+(\d{1,3})\b", normalized)
    if not match:
        match = re.search(r"\b(\d{1,3})\s+(?:students|student|records|results)\b", normalized)
    if not match:
        words = "|".join(NUMBER_WORDS.keys())
        word_match = re.search(rf"\b(?:top|first|show)\s+({words})\b", normalized)
        if word_match:
            return NUMBER_WORDS[word_match.group(1)]
    if not match:
        return default
    value = int(match.group(1))
    return max(1, min(100, value))


def _detect_intent(text: str) -> str:
    q = _normalize_query_text(text)

    if any(k in q for k in ["how many students", "total students", "student count", "count students"]):
        return "total_students"
    if any(k in q for k in ["student named", "details of", "profile of", "performance of student", "info of student"]):
        return "student_lookup"
    if any(k in q for k in ["topper", "high performer", "best students", "top students"]):
        return "top_performers"
    if any(k in q for k in ["low marks", "poor marks", "marks below", "weak marks"]):
        return "low_marks"
    if any(k in q for k in ["missing assignment", "discipline risk", "assignment pending", "assignment missing"]):
        return "missing_assignments"
    if any(k in q for k in ["at risk", "likely fail", "risk students", "critical", "who may fail"]):
        return "at_risk_students"
    if any(k in q for k in ["low attendance", "attendance below", "attendance risk", "absent"]):
        return "low_attendance"
    if any(k in q for k in ["class report", "summary", "overview", "report"]):
        return "class_report"
    return "at_risk_students"


def _extract_name_fragment(text: str) -> str | None:
    q = _normalize_query_text(text)
    quoted = re.search(r"['\"]([^'\"]{2,80})['\"]", q)
    if quoted:
        return quoted.group(1).strip()

    patterns = [
        r"(?:student\s+named|details\s+of|profile\s+of|performance\s+of\s+student|info\s+of\s+student)\s+([a-zA-Z][a-zA-Z\s]{1,80})",
        r"student\s+([a-zA-Z][a-zA-Z\s]{1,80})",
    ]
    for pattern in patterns:
        match = re.search(pattern, q, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1).strip()
        candidate = re.split(r"\s+(?:in|from|for|of)\s+", candidate, maxsplit=1, flags=re.IGNORECASE)[0].strip()
        if len(candidate) >= 2:
            return candidate
    return None


def _teacher_scope_guard(user: dict, class_name: str, section: str) -> None:
    if user.get("role") != "teacher":
        return
    allowed = any(
        item.get("class_name") == class_name and item.get("section") == section
        for item in user.get("assigned_classes", [])
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Class/section not assigned to teacher")


def _attendance_percentage(student_id: str, class_name: str, section: str) -> float:
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
            rec_student = str(rec.get("student_id") or rec.get("roll_no") or "")
            if rec_student != student_id:
                continue
            total += 1
            if str(rec.get("status", "")).lower() == "present":
                present += 1
    return round((present / total) * 100, 2) if total else 0.0


def _risk_for_student(student: dict, class_name: str, section: str) -> dict:
    student_id = str(student.get("roll_no") or student.get("username") or "")
    if not student_id:
        return {}

    records = list(
        performance_collection.find(
            {"student_id": student_id, "class_name": class_name, "section": section},
            {"_id": 0, "marks": 1, "assignment_score": 1, "co_curricular_score": 1},
        )
    )
    marks_values = [float(item.get("marks", 0)) for item in records]
    assignment_values = [float(item.get("assignment_score", 0)) for item in records]

    avg_marks = round(mean(marks_values), 2) if marks_values else 0.0
    avg_assignment = round(mean(assignment_values), 2) if assignment_values else 0.0
    attendance = _attendance_percentage(student_id, class_name, section)

    missing_assignments = sum(1 for score in assignment_values if score <= 0)
    assignment_ratio = round((missing_assignments / len(assignment_values)), 2) if assignment_values else 0.0

    reasons = []
    if attendance < ATTENDANCE_THRESHOLD:
        reasons.append("LOW_ATTENDANCE")
    if avg_marks < MARKS_THRESHOLD:
        reasons.append("LOW_MARKS")
    if avg_assignment < ASSIGNMENT_THRESHOLD or assignment_ratio >= MISSING_ASSIGNMENT_RATIO_THRESHOLD:
        reasons.append("DISCIPLINE_RISK")

    points = len(reasons)
    if points == 0:
        category = "Good"
    elif points == 1:
        category = "Monitor"
    elif points == 2:
        category = "At Risk"
    else:
        category = "Critical"

    return {
        "student_id": student_id,
        "username": student.get("username"),
        "name": student.get("name") or student.get("username"),
        "attendance_percentage": attendance,
        "average_marks": avg_marks,
        "average_assignment_score": avg_assignment,
        "missing_assignment_ratio": assignment_ratio,
        "risk_points": points,
        "risk_category": category,
        "reason_codes": reasons,
    }


def _class_risk_rows(class_name: str, section: str) -> list[dict]:
    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "username": 1, "roll_no": 1, "name": 1},
        )
    )
    rows = []
    for student in students:
        row = _risk_for_student(student, class_name, section)
        if row:
            rows.append(row)
    return rows


def _rows_for_scopes(scopes: list[tuple[str, str]]) -> list[dict]:
    rows = []
    for class_name, section in scopes:
        scoped_rows = _class_risk_rows(class_name, section)
        for row in scoped_rows:
            row["class_name"] = class_name
            row["section"] = section
        rows.extend(scoped_rows)
    return rows


def _resolve_scope_with_user(payload: NLQueryIn, user: dict) -> tuple[str, str]:
    parsed_class, parsed_section = _extract_class_section(payload.query)
    class_name = (payload.class_name or parsed_class or "").strip().upper()
    section = (payload.section or parsed_section or "").strip().upper()

    if not class_name or not section:
        if user.get("role") == "teacher":
            assigned = [
                item for item in user.get("assigned_classes", [])
                if item.get("class_name") and item.get("section")
            ]
            unique = {(str(i["class_name"]).upper(), str(i["section"]).upper()) for i in assigned}
            if len(unique) == 1:
                only_class, only_section = list(unique)[0]
                class_name = class_name or only_class
                section = section or only_section

    if not class_name or not section:
        raise HTTPException(
            status_code=400,
            detail="I could not detect class/section. Try: 'Show at-risk students in MCA-B'.",
        )
    return class_name, section


def _resolve_scopes_with_user(payload: NLQueryIn, user: dict) -> list[tuple[str, str]]:
    parsed_class, parsed_section = _extract_class_section(payload.query)
    class_name = (payload.class_name or parsed_class or "").strip().upper()
    section = (payload.section or parsed_section or "").strip().upper()

    if class_name and section:
        _teacher_scope_guard(user, class_name, section)
        return [(class_name, section)]

    if class_name and not section:
        if user.get("role") == "admin":
            sections = users_collection.distinct("section", {"role": "student", "class_name": class_name})
            scopes = [(class_name, str(sec).upper()) for sec in sections if sec]
            if not scopes:
                raise HTTPException(status_code=404, detail=f"No sections found for class {class_name}")
            return scopes

        assigned = [
            (str(item.get("class_name")).upper(), str(item.get("section")).upper())
            for item in user.get("assigned_classes", [])
            if item.get("class_name") and item.get("section")
        ]
        scopes = [item for item in assigned if item[0] == class_name]
        if not scopes:
            raise HTTPException(status_code=403, detail=f"Class {class_name} not assigned to teacher")
        return scopes

    return [_resolve_scope_with_user(payload, user)]


def _resolve_scope_with_user_optional(payload: NLQueryIn, user: dict) -> tuple[str | None, str | None]:
    parsed_class, parsed_section = _extract_class_section(payload.query)
    class_name = (payload.class_name or parsed_class or "").strip().upper() or None
    section = (payload.section or parsed_section or "").strip().upper() or None

    if (not class_name or not section) and user.get("role") == "teacher":
        assigned = [
            item for item in user.get("assigned_classes", [])
            if item.get("class_name") and item.get("section")
        ]
        unique = {(str(i["class_name"]).upper(), str(i["section"]).upper()) for i in assigned}
        if len(unique) == 1:
            only_class, only_section = list(unique)[0]
            class_name = class_name or only_class
            section = section or only_section
    return class_name, section


def _student_scope_query(user: dict, class_name: str | None, section: str | None) -> dict:
    if user.get("role") == "admin":
        query = {"role": "student"}
        if class_name:
            query["class_name"] = class_name
        if section:
            query["section"] = section
        return query

    assigned = [
        {
            "class_name": str(item.get("class_name", "")).upper(),
            "section": str(item.get("section", "")).upper(),
        }
        for item in user.get("assigned_classes", [])
        if item.get("class_name") and item.get("section")
    ]
    if not assigned:
        raise HTTPException(status_code=403, detail="No assigned class-section found for teacher")

    filtered = assigned
    if class_name:
        filtered = [item for item in filtered if item["class_name"] == class_name]
    if section:
        filtered = [item for item in filtered if item["section"] == section]
    if not filtered:
        raise HTTPException(status_code=403, detail="Class/section not assigned to teacher")

    if len(filtered) == 1:
        return {
            "role": "student",
            "class_name": filtered[0]["class_name"],
            "section": filtered[0]["section"],
        }
    return {
        "role": "student",
        "$or": [{"class_name": item["class_name"], "section": item["section"]} for item in filtered],
    }


def _query_with_name_filter(base_query: dict, name_fragment: str) -> dict:
    name_filter = {
        "$or": [
            {"name": {"$regex": re.escape(name_fragment), "$options": "i"}},
            {"username": {"$regex": re.escape(name_fragment), "$options": "i"}},
            {"roll_no": {"$regex": re.escape(name_fragment), "$options": "i"}},
        ]
    }
    if "$or" not in base_query:
        query = dict(base_query)
        query.update(name_filter)
        return query

    base_or = base_query.get("$or", [])
    simple = {k: v for k, v in base_query.items() if k != "$or"}
    clauses = []
    if simple:
        clauses.append(simple)
    clauses.append({"$or": base_or})
    clauses.append(name_filter)
    return {"$and": clauses}


@router.post("/nl-query")
def nl_query(payload: NLQueryIn, user=Depends(_require_admin_or_teacher)):
    intent = _detect_intent(payload.query)
    top_n = _extract_top_n(payload.query, payload.top_n)

    if intent == "total_students":
        class_name, section = _resolve_scope_with_user_optional(payload, user)
        base_query = _student_scope_query(user, class_name, section)
        total = users_collection.count_documents(base_query)
        pipeline = [
            {"$match": base_query},
            {"$group": {"_id": {"class_name": "$class_name", "section": "$section"}, "count": {"$sum": 1}}},
            {"$sort": {"_id.class_name": 1, "_id.section": 1}},
        ]
        breakdown = [
            {
                "class_name": row["_id"].get("class_name"),
                "section": row["_id"].get("section"),
                "count": row.get("count", 0),
            }
            for row in users_collection.aggregate(pipeline)
        ]
        return {
            "query": payload.query,
            "intent": intent,
            "class_name": class_name,
            "section": section,
            "result": {"total_students": total, "breakdown": breakdown},
        }

    if intent == "student_lookup":
        class_name, section = _resolve_scope_with_user_optional(payload, user)
        name_fragment = _extract_name_fragment(payload.query)
        if not name_fragment:
            raise HTTPException(
                status_code=400,
                detail="Please mention student name in query. Example: details of student Amit in MCA-A.",
            )
        base_query = _student_scope_query(user, class_name, section)
        final_query = _query_with_name_filter(base_query, name_fragment)
        students = list(users_collection.find(final_query, {"_id": 0, "password": 0}).limit(top_n))
        result = []
        for student in students:
            cls = str(student.get("class_name") or "")
            sec = str(student.get("section") or "")
            risk = _risk_for_student(student, cls, sec) if cls and sec else {}
            result.append(
                {
                    "username": student.get("username"),
                    "name": student.get("name"),
                    "roll_no": student.get("roll_no"),
                    "class_name": cls,
                    "section": sec,
                    "risk_category": risk.get("risk_category"),
                    "attendance_percentage": risk.get("attendance_percentage"),
                    "average_marks": risk.get("average_marks"),
                    "reason_codes": risk.get("reason_codes", []),
                }
            )
        return {
            "query": payload.query,
            "intent": intent,
            "class_name": class_name,
            "section": section,
            "result": result,
        }

    scopes = _resolve_scopes_with_user(payload, user)
    class_name, section = scopes[0]
    rows = _rows_for_scopes(scopes)

    if intent == "at_risk_students":
        result = sorted(
            [r for r in rows if r["risk_category"] in {"At Risk", "Critical"}],
            key=lambda item: (item["risk_points"], -item["attendance_percentage"], -item["average_marks"]),
            reverse=True,
        )[:top_n]
    elif intent == "low_attendance":
        result = sorted(rows, key=lambda item: item["attendance_percentage"])[:top_n]
    elif intent == "low_marks":
        result = sorted(rows, key=lambda item: item["average_marks"])[:top_n]
    elif intent == "missing_assignments":
        result = sorted(rows, key=lambda item: item["missing_assignment_ratio"], reverse=True)[:top_n]
    elif intent == "top_performers":
        result = sorted(rows, key=lambda item: (item["average_marks"], item["attendance_percentage"]), reverse=True)[:top_n]
    else:
        dist = {"Good": 0, "Monitor": 0, "At Risk": 0, "Critical": 0}
        for row in rows:
            dist[row["risk_category"]] += 1
        result = {
            "students": len(rows),
            "risk_distribution": dist,
            "average_attendance": round(mean([r["attendance_percentage"] for r in rows]), 2) if rows else 0,
            "average_marks": round(mean([r["average_marks"] for r in rows]), 2) if rows else 0,
        }

    return {
        "query": payload.query,
        "intent": intent,
        "class_name": class_name if len(scopes) == 1 else f"{class_name}+",
        "section": section if len(scopes) == 1 else "MULTI",
        "scopes": [{"class_name": c, "section": s} for c, s in scopes],
        "result": result,
    }


@router.post("/nl-report")
def nl_report(payload: NLQueryIn, user=Depends(_require_admin_or_teacher)):
    scopes = _resolve_scopes_with_user(payload, user)
    class_name, section = scopes[0]
    rows = _rows_for_scopes(scopes)
    if not rows:
        return {
            "class_name": class_name if len(scopes) == 1 else f"{class_name}+",
            "section": section if len(scopes) == 1 else "MULTI",
            "report_text": f"No student performance data found for requested scope.",
        }

    dist = {"Good": 0, "Monitor": 0, "At Risk": 0, "Critical": 0}
    for row in rows:
        dist[row["risk_category"]] += 1
    top_risk = sorted(rows, key=lambda item: item["risk_points"], reverse=True)[:3]
    top_risk_line = ", ".join(
        f"{item['name']} ({item['risk_category']}, reasons: {', '.join(item['reason_codes']) or 'None'})"
        for item in top_risk
    )

    avg_attendance = round(mean([r["attendance_percentage"] for r in rows]), 2)
    avg_marks = round(mean([r["average_marks"] for r in rows]), 2)

    scope_text = ", ".join(f"{c}-{s}" for c, s in scopes[:6])
    if len(scopes) > 6:
        scope_text += f" and {len(scopes) - 6} more"

    report_text = (
        f"Scope {scope_text}: total students {len(rows)}. "
        f"Risk split -> Good: {dist['Good']}, Monitor: {dist['Monitor']}, "
        f"At Risk: {dist['At Risk']}, Critical: {dist['Critical']}. "
        f"Average attendance is {avg_attendance}% and average marks are {avg_marks}%. "
        f"Highest priority students: {top_risk_line}."
    )

    return {
        "query": payload.query,
        "class_name": class_name if len(scopes) == 1 else f"{class_name}+",
        "section": section if len(scopes) == 1 else "MULTI",
        "scopes": [{"class_name": c, "section": s} for c, s in scopes],
        "risk_distribution": dist,
        "report_text": report_text,
    }
