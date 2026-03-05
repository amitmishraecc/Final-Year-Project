import re
from datetime import datetime
from statistics import mean
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import attendance_collection, db, users_collection
from utils.security import get_current_user

router = APIRouter(prefix="/ai", tags=["AI"])
performance_collection = db["performance_records"]
risk_config_collection = db["ai_risk_config"]
risk_config_versions_collection = db["ai_risk_config_versions"]
chat_sessions_collection = db["ai_chat_sessions"]

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


class RiskConfigUpdateIn(BaseModel):
    attendance_threshold: float | None = Field(default=None, ge=0, le=100)
    marks_threshold: float | None = Field(default=None, ge=0, le=100)
    assignment_threshold: float | None = Field(default=None, ge=0, le=100)
    missing_assignment_ratio_threshold: float | None = Field(default=None, ge=0, le=1)
    attendance_weight: float | None = Field(default=None, ge=0, le=1)
    marks_weight: float | None = Field(default=None, ge=0, le=1)
    assignment_weight: float | None = Field(default=None, ge=0, le=1)
    monitor_min: float | None = Field(default=None, ge=0, le=100)
    at_risk_min: float | None = Field(default=None, ge=0, le=100)
    critical_min: float | None = Field(default=None, ge=0, le=100)


class RiskSimulationIn(BaseModel):
    class_name: str | None = None
    section: str | None = None
    top_n_changes: int = Field(default=10, ge=1, le=100)
    attendance_threshold: float | None = Field(default=None, ge=0, le=100)
    marks_threshold: float | None = Field(default=None, ge=0, le=100)
    assignment_threshold: float | None = Field(default=None, ge=0, le=100)
    missing_assignment_ratio_threshold: float | None = Field(default=None, ge=0, le=1)
    attendance_weight: float | None = Field(default=None, ge=0, le=1)
    marks_weight: float | None = Field(default=None, ge=0, le=1)
    assignment_weight: float | None = Field(default=None, ge=0, le=1)
    monitor_min: float | None = Field(default=None, ge=0, le=100)
    at_risk_min: float | None = Field(default=None, ge=0, le=100)
    critical_min: float | None = Field(default=None, ge=0, le=100)


class RiskRollbackIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class NLSessionQueryIn(NLQueryIn):
    session_id: str | None = Field(default=None, min_length=3, max_length=120)


def _require_admin_or_teacher(user=Depends(get_current_user)):
    role = user.get("role")
    if role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Admin or teacher access required")
    return user


def _require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _default_risk_config() -> dict:
    return {
        "attendance_threshold": ATTENDANCE_THRESHOLD,
        "marks_threshold": MARKS_THRESHOLD,
        "assignment_threshold": ASSIGNMENT_THRESHOLD,
        "missing_assignment_ratio_threshold": MISSING_ASSIGNMENT_RATIO_THRESHOLD,
        "weights": {
            "attendance": 0.40,
            "marks": 0.35,
            "assignment": 0.25,
        },
        "cutoffs": {
            "monitor_min": 25.0,
            "at_risk_min": 50.0,
            "critical_min": 75.0,
        },
    }


def _normalize_weights(weights: dict) -> dict:
    raw_att = float(weights.get("attendance", 0))
    raw_marks = float(weights.get("marks", 0))
    raw_assignment = float(weights.get("assignment", 0))
    total = raw_att + raw_marks + raw_assignment
    if total <= 0:
        return _default_risk_config()["weights"]
    return {
        "attendance": round(raw_att / total, 6),
        "marks": round(raw_marks / total, 6),
        "assignment": round(raw_assignment / total, 6),
    }


def _sanitize_risk_config(raw: dict | None) -> dict:
    base = _default_risk_config()
    if not raw:
        return base

    config = {
        "attendance_threshold": float(raw.get("attendance_threshold", base["attendance_threshold"])),
        "marks_threshold": float(raw.get("marks_threshold", base["marks_threshold"])),
        "assignment_threshold": float(raw.get("assignment_threshold", base["assignment_threshold"])),
        "missing_assignment_ratio_threshold": float(
            raw.get("missing_assignment_ratio_threshold", base["missing_assignment_ratio_threshold"])
        ),
        "weights": _normalize_weights(raw.get("weights", base["weights"])),
        "cutoffs": {
            "monitor_min": float(raw.get("cutoffs", {}).get("monitor_min", base["cutoffs"]["monitor_min"])),
            "at_risk_min": float(raw.get("cutoffs", {}).get("at_risk_min", base["cutoffs"]["at_risk_min"])),
            "critical_min": float(raw.get("cutoffs", {}).get("critical_min", base["cutoffs"]["critical_min"])),
        },
    }

    monitor_min = config["cutoffs"]["monitor_min"]
    at_risk_min = config["cutoffs"]["at_risk_min"]
    critical_min = config["cutoffs"]["critical_min"]
    if not (0 <= monitor_min < at_risk_min < critical_min <= 100):
        raise HTTPException(
            status_code=400,
            detail="Invalid cutoffs. Must satisfy: 0 <= monitor_min < at_risk_min < critical_min <= 100.",
        )
    return config


def _get_risk_config() -> dict:
    raw = risk_config_collection.find_one({"_id": "default"}, {"_id": 0})
    return _sanitize_risk_config(raw)


def _next_risk_config_version() -> int:
    latest = risk_config_versions_collection.find_one({}, {"_id": 0, "version": 1}, sort=[("version", -1)])
    return int(latest.get("version", 0)) + 1 if latest else 1


def _create_risk_config_version(config: dict, updated_by: str, action: str, source_version: int | None = None) -> dict:
    version = _next_risk_config_version()
    doc = {
        "version": version,
        "config": _sanitize_risk_config(config),
        "updated_by": updated_by,
        "action": action,
        "source_version": source_version,
        "created_at": datetime.utcnow().isoformat(),
    }
    risk_config_versions_collection.insert_one(doc)
    return doc


def _risk_config_from_overrides(current: dict, payload: RiskConfigUpdateIn | RiskSimulationIn) -> dict:
    next_config = {
        "attendance_threshold": payload.attendance_threshold
        if payload.attendance_threshold is not None
        else current["attendance_threshold"],
        "marks_threshold": payload.marks_threshold
        if payload.marks_threshold is not None
        else current["marks_threshold"],
        "assignment_threshold": payload.assignment_threshold
        if payload.assignment_threshold is not None
        else current["assignment_threshold"],
        "missing_assignment_ratio_threshold": payload.missing_assignment_ratio_threshold
        if payload.missing_assignment_ratio_threshold is not None
        else current["missing_assignment_ratio_threshold"],
        "weights": {
            "attendance": payload.attendance_weight
            if payload.attendance_weight is not None
            else current["weights"]["attendance"],
            "marks": payload.marks_weight if payload.marks_weight is not None else current["weights"]["marks"],
            "assignment": payload.assignment_weight
            if payload.assignment_weight is not None
            else current["weights"]["assignment"],
        },
        "cutoffs": {
            "monitor_min": payload.monitor_min if payload.monitor_min is not None else current["cutoffs"]["monitor_min"],
            "at_risk_min": payload.at_risk_min if payload.at_risk_min is not None else current["cutoffs"]["at_risk_min"],
            "critical_min": payload.critical_min
            if payload.critical_min is not None
            else current["cutoffs"]["critical_min"],
        },
    }
    return _sanitize_risk_config(next_config)


def _score_band(score: float, cutoffs: dict) -> str:
    if score >= float(cutoffs["critical_min"]):
        return "Critical"
    if score >= float(cutoffs["at_risk_min"]):
        return "At Risk"
    if score >= float(cutoffs["monitor_min"]):
        return "Monitor"
    return "Good"


def _severity_below_threshold(value: float, threshold: float) -> float:
    if value >= threshold:
        return 0.0
    return max(0.0, min(1.0, (threshold - value) / max(threshold, 1e-6)))


def _severity_above_ratio(value: float, threshold: float) -> float:
    if value <= threshold:
        return 0.0
    scale = max(1e-6, 1 - threshold)
    return max(0.0, min(1.0, (value - threshold) / scale))


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


def _risk_for_student(student: dict, class_name: str, section: str, risk_config: dict) -> dict:
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

    att_threshold = float(risk_config["attendance_threshold"])
    marks_threshold = float(risk_config["marks_threshold"])
    assignment_threshold = float(risk_config["assignment_threshold"])
    missing_ratio_threshold = float(risk_config["missing_assignment_ratio_threshold"])
    weights = risk_config["weights"]

    attendance_severity = _severity_below_threshold(attendance, att_threshold)
    marks_severity = _severity_below_threshold(avg_marks, marks_threshold)
    assignment_severity = max(
        _severity_below_threshold(avg_assignment, assignment_threshold),
        _severity_above_ratio(assignment_ratio, missing_ratio_threshold),
    )

    reasons = []
    if attendance < att_threshold:
        reasons.append("LOW_ATTENDANCE")
    if avg_marks < marks_threshold:
        reasons.append("LOW_MARKS")
    if avg_assignment < assignment_threshold or assignment_ratio >= missing_ratio_threshold:
        reasons.append("DISCIPLINE_RISK")

    points = len(reasons)
    weighted_score = round(
        (
            attendance_severity * float(weights["attendance"])
            + marks_severity * float(weights["marks"])
            + assignment_severity * float(weights["assignment"])
        )
        * 100,
        2,
    )
    category = _score_band(weighted_score, risk_config["cutoffs"])

    reason_breakdown = [
        {
            "code": "LOW_ATTENDANCE",
            "triggered": attendance < att_threshold,
            "value": attendance,
            "threshold": att_threshold,
            "weight": float(weights["attendance"]),
            "severity": round(attendance_severity, 4),
            "weighted_impact": round(attendance_severity * float(weights["attendance"]) * 100, 2),
        },
        {
            "code": "LOW_MARKS",
            "triggered": avg_marks < marks_threshold,
            "value": avg_marks,
            "threshold": marks_threshold,
            "weight": float(weights["marks"]),
            "severity": round(marks_severity, 4),
            "weighted_impact": round(marks_severity * float(weights["marks"]) * 100, 2),
        },
        {
            "code": "DISCIPLINE_RISK",
            "triggered": avg_assignment < assignment_threshold or assignment_ratio >= missing_ratio_threshold,
            "value": {
                "average_assignment_score": avg_assignment,
                "missing_assignment_ratio": assignment_ratio,
            },
            "threshold": {
                "assignment_threshold": assignment_threshold,
                "missing_assignment_ratio_threshold": missing_ratio_threshold,
            },
            "weight": float(weights["assignment"]),
            "severity": round(assignment_severity, 4),
            "weighted_impact": round(assignment_severity * float(weights["assignment"]) * 100, 2),
        },
    ]

    return {
        "student_id": student_id,
        "username": student.get("username"),
        "name": student.get("name") or student.get("username"),
        "attendance_percentage": attendance,
        "average_marks": avg_marks,
        "average_assignment_score": avg_assignment,
        "missing_assignment_ratio": assignment_ratio,
        "risk_points": points,
        "risk_score": weighted_score,
        "risk_category": category,
        "reason_codes": reasons,
        "risk_reason_breakdown": reason_breakdown,
    }


def _class_risk_rows(class_name: str, section: str, risk_config: dict) -> list[dict]:
    students = list(
        users_collection.find(
            {"role": "student", "class_name": class_name, "section": section},
            {"_id": 0, "username": 1, "roll_no": 1, "name": 1},
        )
    )
    rows = []
    for student in students:
        row = _risk_for_student(student, class_name, section, risk_config)
        if row:
            rows.append(row)
    return rows


def _rows_for_scopes(scopes: list[tuple[str, str]], risk_config: dict) -> list[dict]:
    rows = []
    for class_name, section in scopes:
        scoped_rows = _class_risk_rows(class_name, section, risk_config)
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


def _resolve_scopes_explicit(class_name: str | None, section: str | None, user: dict) -> list[tuple[str, str]]:
    class_name = (class_name or "").strip().upper() or None
    section = (section or "").strip().upper() or None

    if class_name and section:
        _teacher_scope_guard(user, class_name, section)
        return [(class_name, section)]

    if user.get("role") == "admin":
        pipeline = [
            {"$match": {"role": "student"}},
            {"$group": {"_id": {"class_name": "$class_name", "section": "$section"}}},
            {"$sort": {"_id.class_name": 1, "_id.section": 1}},
        ]
        scopes = []
        for row in users_collection.aggregate(pipeline):
            cls = str(row["_id"].get("class_name") or "").strip().upper()
            sec = str(row["_id"].get("section") or "").strip().upper()
            if not cls or not sec:
                continue
            if class_name and cls != class_name:
                continue
            if section and sec != section:
                continue
            scopes.append((cls, sec))
        if not scopes:
            raise HTTPException(status_code=404, detail="No class/section scope found for simulation.")
        return scopes

    assigned = [
        (str(item.get("class_name")).upper(), str(item.get("section")).upper())
        for item in user.get("assigned_classes", [])
        if item.get("class_name") and item.get("section")
    ]
    if not assigned:
        raise HTTPException(status_code=403, detail="No assigned class-section found for teacher")
    scopes = assigned
    if class_name:
        scopes = [item for item in scopes if item[0] == class_name]
    if section:
        scopes = [item for item in scopes if item[1] == section]
    if not scopes:
        raise HTTPException(status_code=403, detail="Requested class/section not assigned to teacher")
    return sorted(set(scopes))


def _risk_distribution(rows: list[dict]) -> dict:
    dist = {"Good": 0, "Monitor": 0, "At Risk": 0, "Critical": 0}
    for row in rows:
        dist[row["risk_category"]] += 1
    return dist


def _session_key(user: dict, session_id: str) -> dict:
    return {
        "session_id": session_id.strip(),
        "owner_username": str(user.get("username") or ""),
        "owner_role": str(user.get("role") or ""),
    }


def _resolve_effective_scope(payload: NLSessionQueryIn, session_doc: dict | None) -> tuple[str | None, str | None]:
    class_name = (payload.class_name or "").strip().upper() or None
    section = (payload.section or "").strip().upper() or None
    if class_name and section:
        return class_name, section
    if not session_doc:
        return class_name, section
    last_scope = session_doc.get("last_scope") or {}
    return class_name or last_scope.get("class_name"), section or last_scope.get("section")


def _compact_result_for_history(intent: str, result) -> dict:
    if isinstance(result, list):
        return {"items": len(result), "preview": result[:3]}
    if isinstance(result, dict):
        return {
            "keys": list(result.keys())[:10],
            "preview": {k: result[k] for k in list(result.keys())[:5]},
        }
    return {"value": str(result)}


def _append_session_turn(session_key: dict, query: str, response: dict, source_scope: tuple[str | None, str | None]) -> None:
    turns_limit = 30
    turn = {
        "at": datetime.utcnow().isoformat(),
        "query": query,
        "intent": response.get("intent"),
        "scope": {
            "class_name": source_scope[0],
            "section": source_scope[1],
        },
        "response_summary": _compact_result_for_history(response.get("intent", ""), response.get("result")),
    }
    current = chat_sessions_collection.find_one(session_key, {"_id": 0, "turns": 1})
    existing_turns = current.get("turns", []) if current else []
    next_turns = (existing_turns + [turn])[-turns_limit:]

    scopes = response.get("scopes") or []
    last_scope = None
    if len(scopes) == 1:
        item = scopes[0]
        last_scope = {
            "class_name": str(item.get("class_name") or "").upper() or None,
            "section": str(item.get("section") or "").upper() or None,
        }
    elif source_scope[0] and source_scope[1]:
        last_scope = {"class_name": source_scope[0], "section": source_scope[1]}

    update_doc = {
        "updated_at": datetime.utcnow().isoformat(),
        "turns": next_turns,
    }
    if last_scope:
        update_doc["last_scope"] = last_scope

    chat_sessions_collection.update_one(
        session_key,
        {
            "$set": update_doc,
            "$setOnInsert": {
                "created_at": datetime.utcnow().isoformat(),
            },
        },
        upsert=True,
    )


@router.get("/risk-config")
def get_risk_config(user=Depends(_require_admin_or_teacher)):
    config = _get_risk_config()
    return {"risk_config": config}


@router.get("/risk-config/versions")
def list_risk_config_versions(
    limit: int = Query(default=20, ge=1, le=200),
    user=Depends(_require_admin_or_teacher),
):
    rows = list(
        risk_config_versions_collection.find({}, {"_id": 0}).sort("version", -1).limit(limit)
    )
    return {"versions": rows, "count": len(rows)}


@router.put("/risk-config")
def update_risk_config(payload: RiskConfigUpdateIn, admin=Depends(_require_admin)):
    current = _get_risk_config()
    validated = _risk_config_from_overrides(current, payload)
    version_doc = _create_risk_config_version(
        config=validated,
        updated_by=str(admin.get("username") or "system"),
        action="update",
    )
    risk_config_collection.update_one(
        {"_id": "default"},
        {
            "$set": {
                **validated,
                "updated_at": datetime.utcnow().isoformat(),
                "updated_by": admin.get("username"),
                "version": version_doc["version"],
            }
        },
        upsert=True,
    )
    return {
        "message": "Risk configuration updated",
        "risk_config": validated,
        "version": version_doc["version"],
    }


@router.post("/risk-config/rollback/{version}")
def rollback_risk_config(version: int, payload: RiskRollbackIn, admin=Depends(_require_admin)):
    if version <= 0:
        raise HTTPException(status_code=400, detail="Version must be positive.")

    target = risk_config_versions_collection.find_one({"version": version}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail=f"Risk config version {version} not found.")

    restored = _sanitize_risk_config(target.get("config"))
    version_doc = _create_risk_config_version(
        config=restored,
        updated_by=str(admin.get("username") or "system"),
        action="rollback",
        source_version=version,
    )

    risk_config_collection.update_one(
        {"_id": "default"},
        {
            "$set": {
                **restored,
                "updated_at": datetime.utcnow().isoformat(),
                "updated_by": admin.get("username"),
                "version": version_doc["version"],
                "rollback_from_version": version,
                "rollback_reason": (payload.reason or "").strip() or None,
            }
        },
        upsert=True,
    )
    return {
        "message": f"Risk configuration rolled back from version {version}.",
        "risk_config": restored,
        "version": version_doc["version"],
    }


@router.post("/risk-simulate")
def simulate_risk(payload: RiskSimulationIn, user=Depends(_require_admin_or_teacher)):
    current = _get_risk_config()
    simulated = _risk_config_from_overrides(current, payload)
    scopes = _resolve_scopes_explicit(payload.class_name, payload.section, user)

    before_rows = _rows_for_scopes(scopes, current)
    after_rows = _rows_for_scopes(scopes, simulated)

    if not before_rows:
        return {
            "scopes": [{"class_name": c, "section": s} for c, s in scopes],
            "current_config": current,
            "simulated_config": simulated,
            "summary": {
                "students": 0,
                "before_distribution": {"Good": 0, "Monitor": 0, "At Risk": 0, "Critical": 0},
                "after_distribution": {"Good": 0, "Monitor": 0, "At Risk": 0, "Critical": 0},
                "avg_risk_score_before": 0,
                "avg_risk_score_after": 0,
                "moved_higher_risk": 0,
                "moved_lower_risk": 0,
            },
            "top_changes": [],
        }

    before_map = {
        f"{row['class_name']}::{row['section']}::{row['student_id']}": row
        for row in before_rows
    }
    after_map = {
        f"{row['class_name']}::{row['section']}::{row['student_id']}": row
        for row in after_rows
    }

    rank = {"Good": 0, "Monitor": 1, "At Risk": 2, "Critical": 3}
    changes = []
    moved_higher = 0
    moved_lower = 0
    for key, before in before_map.items():
        after = after_map.get(key)
        if not after:
            continue
        before_rank = rank[before["risk_category"]]
        after_rank = rank[after["risk_category"]]
        if after_rank > before_rank:
            moved_higher += 1
        elif after_rank < before_rank:
            moved_lower += 1
        changes.append(
            {
                "student_id": before["student_id"],
                "name": before.get("name"),
                "username": before.get("username"),
                "class_name": before.get("class_name"),
                "section": before.get("section"),
                "before_category": before["risk_category"],
                "after_category": after["risk_category"],
                "before_score": before["risk_score"],
                "after_score": after["risk_score"],
                "score_delta": round(after["risk_score"] - before["risk_score"], 2),
            }
        )

    changes.sort(key=lambda row: abs(row["score_delta"]), reverse=True)
    return {
        "scopes": [{"class_name": c, "section": s} for c, s in scopes],
        "current_config": current,
        "simulated_config": simulated,
        "summary": {
            "students": len(before_rows),
            "before_distribution": _risk_distribution(before_rows),
            "after_distribution": _risk_distribution(after_rows),
            "avg_risk_score_before": round(mean([row["risk_score"] for row in before_rows]), 2),
            "avg_risk_score_after": round(mean([row["risk_score"] for row in after_rows]), 2),
            "moved_higher_risk": moved_higher,
            "moved_lower_risk": moved_lower,
        },
        "top_changes": changes[: payload.top_n_changes],
    }


@router.post("/nl-query/session")
def nl_query_with_session(payload: NLSessionQueryIn, user=Depends(_require_admin_or_teacher)):
    session_id = (payload.session_id or str(uuid4())).strip()
    session_key = _session_key(user, session_id)
    session_doc = chat_sessions_collection.find_one(session_key, {"_id": 0, "last_scope": 1, "turns": 1})

    effective_class, effective_section = _resolve_effective_scope(payload, session_doc)
    effective_payload = NLQueryIn(
        query=payload.query,
        class_name=effective_class,
        section=effective_section,
        top_n=payload.top_n,
    )

    response = nl_query(effective_payload, user)
    _append_session_turn(
        session_key=session_key,
        query=payload.query,
        response=response,
        source_scope=(effective_class, effective_section),
    )
    return {"session_id": session_id, **response}


@router.get("/nl-session/{session_id}")
def get_nl_session(session_id: str, user=Depends(_require_admin_or_teacher)):
    key = _session_key(user, session_id)
    session_doc = chat_sessions_collection.find_one(key, {"_id": 0})
    if not session_doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_doc


@router.post("/nl-query")
def nl_query(payload: NLQueryIn, user=Depends(_require_admin_or_teacher)):
    intent = _detect_intent(payload.query)
    top_n = _extract_top_n(payload.query, payload.top_n)
    risk_config = _get_risk_config()

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
            risk = _risk_for_student(student, cls, sec, risk_config) if cls and sec else {}
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
    rows = _rows_for_scopes(scopes, risk_config)

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
        dist = _risk_distribution(rows)
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
        "risk_config": risk_config,
        "result": result,
    }


@router.post("/nl-report")
def nl_report(payload: NLQueryIn, user=Depends(_require_admin_or_teacher)):
    scopes = _resolve_scopes_with_user(payload, user)
    class_name, section = scopes[0]
    risk_config = _get_risk_config()
    rows = _rows_for_scopes(scopes, risk_config)
    if not rows:
        return {
            "class_name": class_name if len(scopes) == 1 else f"{class_name}+",
            "section": section if len(scopes) == 1 else "MULTI",
            "report_text": f"No student performance data found for requested scope.",
        }

    dist = _risk_distribution(rows)
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
        "risk_config": risk_config,
        "risk_distribution": dist,
        "report_text": report_text,
    }
