import csv
import random
from datetime import date, datetime, timedelta
from pathlib import Path

from database import db, users_collection
from utils.security import hash_password


def _dummy_data_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "dummy"


def _build_recent_academic_dates(days: int = 36) -> list[str]:
    dates: list[str] = []
    cursor = date.today()
    while len(dates) < days:
        if cursor.weekday() < 5:
            dates.append(cursor.isoformat())
        cursor -= timedelta(days=1)
    dates.reverse()
    return dates


def _student_profile(username: str) -> dict:
    key = sum(ord(ch) for ch in username) % 5
    if key == 0:
        return {"label": "top", "attendance_prob": 0.96, "marks_base": 86, "assignment_base": 88, "co_base": 84}
    if key == 1:
        return {"label": "good", "attendance_prob": 0.90, "marks_base": 75, "assignment_base": 78, "co_base": 74}
    if key == 2:
        return {"label": "average", "attendance_prob": 0.82, "marks_base": 64, "assignment_base": 66, "co_base": 68}
    if key == 3:
        return {"label": "improving", "attendance_prob": 0.78, "marks_base": 52, "assignment_base": 56, "co_base": 60}
    return {"label": "at_risk", "attendance_prob": 0.68, "marks_base": 38, "assignment_base": 40, "co_base": 52}


def _clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 2)


def _seed_prediction_history() -> dict:
    attendance = db["attendance"]
    performance = db["performance_records"]
    subject_assignments = db["subject_teacher_assignments"]

    students = list(
        users_collection.find(
            {"role": "student"},
            {"_id": 0, "username": 1, "roll_no": 1, "class_name": 1, "section": 1},
        )
    )
    class_section_map: dict[tuple[str, str], list[dict]] = {}
    for student in students:
        class_name = str(student.get("class_name") or "").strip()
        section = str(student.get("section") or "").strip()
        if not class_name or not section:
            continue
        class_section_map.setdefault((class_name, section), []).append(student)

    teacher_pool: dict[tuple[str, str], list[str]] = {}
    for row in subject_assignments.find({}, {"_id": 0, "class_name": 1, "section": 1, "teacher_username": 1}):
        key = (str(row.get("class_name") or ""), str(row.get("section") or ""))
        teacher_pool.setdefault(key, [])
        teacher = str(row.get("teacher_username") or "").strip()
        if teacher and teacher not in teacher_pool[key]:
            teacher_pool[key].append(teacher)

    dates = _build_recent_academic_dates(36)
    rng = random.Random(2026)

    attendance_docs = 0
    performance_docs = 0
    for (class_name, section), roster in class_section_map.items():
        if not roster:
            continue
        class_teachers = teacher_pool.get((class_name, section), [])
        for day_index, day in enumerate(dates):
            records = []
            for student in roster:
                student_id = str(student.get("roll_no") or student.get("username") or "").strip()
                if not student_id:
                    continue
                profile = _student_profile(str(student.get("username") or ""))
                trend = (day_index / max(len(dates) - 1, 1)) * 8.0 if profile["label"] == "improving" else 0.0
                present_prob = max(0.45, min(0.98, profile["attendance_prob"] + rng.uniform(-0.04, 0.04)))
                present = rng.random() < present_prob
                records.append(
                    {
                        "student_id": student_id,
                        "status": "Present" if present else "Absent",
                    }
                )

                marks = _clamp_score(profile["marks_base"] + trend + rng.uniform(-14, 12))
                assignment = _clamp_score(profile["assignment_base"] + trend + rng.uniform(-16, 14))
                co_score = _clamp_score(profile["co_base"] + rng.uniform(-12, 12))
                if profile["label"] == "at_risk" and rng.random() < 0.18:
                    assignment = 0.0

                perf_teacher = (
                    class_teachers[day_index % len(class_teachers)]
                    if class_teachers
                    else "system_seed"
                )
                performance.update_one(
                    {
                        "class_name": class_name,
                        "section": section,
                        "date": day,
                        "student_id": student_id,
                    },
                    {
                        "$set": {
                            "class_name": class_name,
                            "section": section,
                            "date": day,
                            "student_id": student_id,
                            "marks": marks,
                            "assignment_score": assignment,
                            "co_curricular_score": co_score,
                            "teacher_username": perf_teacher,
                            "updated_at": datetime.utcnow().isoformat(),
                            "seed_source": "prediction_dummy_v2",
                        }
                    },
                    upsert=True,
                )
                performance_docs += 1

            attendance_teacher = (
                class_teachers[day_index % len(class_teachers)]
                if class_teachers
                else "system_seed"
            )
            attendance.update_one(
                {"class_name": class_name, "section": section, "date": day},
                {
                    "$set": {
                        "class_name": class_name,
                        "section": section,
                        "date": day,
                        "teacher_username": attendance_teacher,
                        "records": records,
                        "updated_at": datetime.utcnow().isoformat(),
                        "seed_source": "prediction_dummy_v2",
                    }
                },
                upsert=True,
            )
            attendance_docs += 1

    return {"attendance_docs_upserted": attendance_docs, "performance_docs_upserted": performance_docs}


def seed_dummy_data() -> dict:
    base = _dummy_data_dir()
    teachers_file = base / "teachers.csv"
    students_file = base / "students.csv"
    assignments_file = base / "teacher_assignments.csv"
    sheets_file = base / "google_sheets_configs.csv"
    class_sections_file = base / "class_sections.csv"
    subjects_file = base / "subjects.csv"
    subject_assignments_file = base / "subject_assignments.csv"

    if not teachers_file.exists() or not students_file.exists() or not assignments_file.exists():
        raise FileNotFoundError("Dummy CSV files are missing in backend/data/dummy")

    teachers_created = 0
    students_created = 0

    with teachers_file.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        for row in reader:
            username = row["username"].strip()
            password = row["password"].strip()
            teacher_name = str(row.get("name") or username).strip()

            existing = users_collection.find_one({"username": username})
            if existing:
                users_collection.update_one(
                    {"username": username},
                    {"$set": {"role": "teacher", "name": teacher_name}, "$setOnInsert": {"assigned_classes": []}},
                )
                continue

            users_collection.insert_one(
                {
                    "username": username,
                    "password": hash_password(password),
                    "role": "teacher",
                    "name": teacher_name,
                    "assigned_classes": [],
                }
            )
            teachers_created += 1

    with assignments_file.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        for row in reader:
            users_collection.update_one(
                {"username": row["teacher_username"].strip(), "role": "teacher"},
                {
                    "$addToSet": {
                        "assigned_classes": {
                            "class_name": row["class_name"].strip(),
                            "section": row["section"].strip(),
                        }
                    }
                },
            )

    with students_file.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        for row in reader:
            username = row["username"].strip()
            roll_no = row["roll_no"].strip()
            payload = {
                "username": username,
                "role": "student",
                "roll_no": roll_no,
                "name": row["name"].strip(),
                "class_name": row["class_name"].strip(),
                "section": row["section"].strip(),
            }
            existing = users_collection.find_one(
                {
                    "role": "student",
                    "$or": [
                        {"username": username},
                        {"roll_no": roll_no},
                    ],
                }
            )

            if existing:
                users_collection.update_one({"_id": existing["_id"]}, {"$set": payload})
            else:
                users_collection.insert_one(
                    {
                        **payload,
                        "password": hash_password(row["password"].strip()),
                    }
                )
                students_created += 1

    sheet_configs = db["google_sheet_configs"]
    class_sections_collection = db["class_sections"]
    subject_assignments_collection = db["subject_teacher_assignments"]
    if sheets_file.exists():
        with sheets_file.open(newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                teacher_username = row["teacher_username"].strip()
                class_name = row["class_name"].strip()
                section = row["section"].strip()
                sheet_url = row["sheet_url"].strip()
                sheet_configs.update_one(
                    {
                        "teacher_username": teacher_username,
                        "class_name": class_name,
                        "section": section,
                    },
                    {
                        "$set": {
                            "teacher_username": teacher_username,
                            "class_name": class_name,
                            "section": section,
                            "sheet_url": sheet_url,
                        }
                    },
                    upsert=True,
                )

    if class_sections_file.exists():
        with class_sections_file.open(newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                class_sections_collection.update_one(
                    {"class_name": row["class_name"].strip(), "section": row["section"].strip()},
                    {
                        "$set": {
                            "class_name": row["class_name"].strip(),
                            "section": row["section"].strip(),
                            "program": row.get("program", "").strip() or row["class_name"].strip(),
                            "semester": int(row["semester"]) if row.get("semester") else None,
                        },
                        "$setOnInsert": {"subjects": []},
                    },
                    upsert=True,
                )

    if subjects_file.exists():
        grouped: dict[tuple[str, str], list[dict]] = {}
        with subjects_file.open(newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                key = (row["class_name"].strip(), row["section"].strip())
                grouped.setdefault(key, []).append(
                    {
                        "subject_code": row["subject_code"].strip(),
                        "subject_name": row["subject_name"].strip(),
                        "subject_type": row["subject_type"].strip(),
                        "max_marks": float(row["max_marks"]),
                    }
                )
        for (class_name, section), subjects in grouped.items():
            class_sections_collection.update_one(
                {"class_name": class_name, "section": section},
                {
                    "$set": {
                        "class_name": class_name,
                        "section": section,
                        "subjects": subjects,
                    }
                },
                upsert=True,
            )

    if subject_assignments_file.exists():
        class_docs = list(class_sections_collection.find({}, {"_id": 0}))
        subject_meta = {}
        for doc in class_docs:
            for subject in doc.get("subjects", []):
                subject_meta[(doc["class_name"], doc["section"], subject["subject_code"])] = subject

        with subject_assignments_file.open(newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                class_name = row["class_name"].strip()
                section = row["section"].strip()
                subject_code = row["subject_code"].strip()
                teacher_username = row["teacher_username"].strip()
                meta = subject_meta.get((class_name, section, subject_code), {})

                subject_assignments_collection.update_one(
                    {
                        "teacher_username": teacher_username,
                        "class_name": class_name,
                        "section": section,
                        "subject_code": subject_code,
                    },
                    {
                        "$set": {
                            "teacher_username": teacher_username,
                            "class_name": class_name,
                            "section": section,
                            "subject_code": subject_code,
                            "subject_name": meta.get("subject_name", ""),
                            "subject_type": meta.get("subject_type", ""),
                            "max_marks": float(meta.get("max_marks", 100)),
                        }
                    },
                    upsert=True,
                )
                users_collection.update_one(
                    {"username": teacher_username, "role": "teacher"},
                    {"$addToSet": {"assigned_classes": {"class_name": class_name, "section": section}}},
                )

    prediction_seed = _seed_prediction_history()

    return {
        "teachers_created": teachers_created,
        "students_created": students_created,
        "attendance_docs_upserted": prediction_seed["attendance_docs_upserted"],
        "performance_docs_upserted": prediction_seed["performance_docs_upserted"],
        "message": "Dummy data seeded/updated in MongoDB",
    }
