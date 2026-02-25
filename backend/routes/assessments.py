from datetime import datetime
import random
from statistics import mean

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import attendance_collection, db
from utils.roles import require_student, require_teacher

router = APIRouter(prefix="/assessments", tags=["AI Assessments"])

assessments_collection = db["ai_assessments"]
attempts_collection = db["assessment_attempts"]
subject_marks_collection = db["subject_marks"]
recommendations_collection = db["recommendation_history"]

MAX_TAB_VIOLATIONS = 3
POOR_TOPIC_THRESHOLD = 50.0

STOPWORDS = {
    "the", "is", "a", "an", "to", "for", "of", "in", "on", "at", "and", "or", "with", "explain", "describe", "what", "why", "how", "about", "topic", "level", "from", "by", "as", "be", "this", "that",
}

RESOURCE_LIBRARY = {
    "python": [
        {"title": "Python Full Course", "type": "youtube", "url": "https://www.youtube.com/watch?v=rfscVS0vtbw"},
        {"title": "Python Basics PDF", "type": "pdf", "url": "https://www.w3schools.com/python/python_reference.pdf"},
        {"title": "Python Official Tutorial", "type": "pdf", "url": "https://docs.python.org/3/tutorial/tutorial.pdf"},
    ],
    "java": [
        {"title": "Java Tutorial for Beginners", "type": "youtube", "url": "https://www.youtube.com/watch?v=eIrMbAQSU34"},
        {"title": "Java Notes PDF", "type": "pdf", "url": "https://enos.itcollege.ee/~jpoial/allalaadimised/reading/ThinkingInJava3.pdf"},
        {"title": "Oracle Java Learning", "type": "pdf", "url": "https://www.oracle.com/a/ocom/docs/corporate/java-learning-subscription-brochure.pdf"},
    ],
    "database": [
        {"title": "DBMS Full Course", "type": "youtube", "url": "https://www.youtube.com/watch?v=HXV3zeQKqGY"},
        {"title": "SQL Tutorial PDF", "type": "pdf", "url": "https://www.tutorialspoint.com/sql/sql_tutorial.pdf"},
        {"title": "MongoDB University", "type": "youtube", "url": "https://www.youtube.com/@MongoDB"},
    ],
    "default": [
        {"title": "Study Skills for Exams", "type": "youtube", "url": "https://www.youtube.com/watch?v=IlU-zDU6aQ0"},
        {"title": "Learning How to Learn", "type": "pdf", "url": "https://www.coursera.org/learn/learning-how-to-learn"},
        {"title": "Active Recall Guide", "type": "pdf", "url": "https://www.usu.edu/academic-support/brainfuse/docs/active-recall.pdf"},
    ],
}


class AssessmentGenerateIn(BaseModel):
    title: str = Field(..., min_length=1)
    class_name: str
    section: str
    subject_code: str = Field(..., min_length=1)
    topic: str = Field(..., min_length=2)
    difficulty: str = Field(..., pattern="^(Easy|Medium|Hard)$")
    number_of_questions: int = Field(..., ge=2, le=100)
    total_marks: float = Field(..., gt=0)


class GeneratedQuestionIn(BaseModel):
    question_id: str = Field(..., min_length=1)
    type: str = Field(..., pattern="^(mcq|descriptive)$")
    question: str = Field(..., min_length=3)
    options: list[str] = []
    correct_answer: str | None = None
    marks: float = Field(..., gt=0)


class AssessmentEditIn(BaseModel):
    title: str | None = None
    questions: list[GeneratedQuestionIn] | None = None


class StudentAnswerIn(BaseModel):
    question_id: str = Field(..., min_length=1)
    response: str = ""


class AssessmentSubmitIn(BaseModel):
    answers: list[StudentAnswerIn] = Field(default_factory=list)


class TabViolationIn(BaseModel):
    reason: str = "tab_switch"


def _is_assigned(user: dict, class_name: str, section: str) -> bool:
    return any(
        item.get("class_name") == class_name and item.get("section") == section
        for item in user.get("assigned_classes", [])
    )


def _ensure_assigned(user: dict, class_name: str, section: str) -> None:
    if not _is_assigned(user, class_name, section):
        raise HTTPException(status_code=403, detail="Class not assigned to teacher")


def _assessment_for_teacher(assessment_id: str, user: dict) -> dict:
    if not ObjectId.is_valid(assessment_id):
        raise HTTPException(status_code=400, detail="Invalid assessment id")
    doc = assessments_collection.find_one({"_id": ObjectId(assessment_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if doc.get("teacher_username") != user.get("username"):
        raise HTTPException(status_code=403, detail="Not allowed")
    return doc


def _question_marks(total_marks: float, count: int) -> list[float]:
    if count <= 0:
        return []
    base = round(total_marks / count, 2)
    marks = [base for _ in range(count)]
    marks[-1] = round(total_marks - sum(marks[:-1]), 2)
    if marks[-1] <= 0:
        marks[-1] = base
    return marks


def _normalize_topic(topic: str) -> str:
    return " ".join(topic.strip().split())


def _parse_topics(topic_text: str) -> list[str]:
    raw = [item.strip() for item in str(topic_text or "").split(",")]
    cleaned = []
    seen = set()
    for item in raw:
        normalized = _normalize_topic(item)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(normalized)
    return cleaned or ["General Aptitude"]


def _distributed_topics(topics: list[str], num_questions: int) -> list[str]:
    bag = []
    topic_count = max(1, len(topics))
    base = num_questions // topic_count
    rem = num_questions % topic_count
    for idx, topic in enumerate(topics):
        count = base + (1 if idx < rem else 0)
        bag.extend([topic] * count)
    random.shuffle(bag)
    return bag[:num_questions]


def _difficulty_focus_pool(difficulty: str) -> list[str]:
    if difficulty == "Easy":
        return [
            "core definition",
            "basic concept",
            "simple application",
            "foundational principle",
            "direct interpretation",
        ]
    if difficulty == "Hard":
        return [
            "trade-off analysis",
            "edge-case reasoning",
            "optimization strategy",
            "constraint-aware decision",
            "failure-mode handling",
        ]
    return [
        "scenario-based application",
        "method selection",
        "comparative reasoning",
        "error identification",
        "stepwise problem-solving",
    ]


def _difficulty_question_templates(difficulty: str) -> list[str]:
    if difficulty == "Easy":
        return [
            "In {topic}, which option best represents the {focus}?",
            "Which statement correctly explains the {focus} in {topic}?",
            "Identify the most accurate option about {focus} in {topic}.",
        ]
    if difficulty == "Hard":
        return [
            "For {topic}, choose the best approach for {focus} under realistic constraints.",
            "In an advanced {topic} scenario, which option best handles {focus}?",
            "Which option is most appropriate for {focus} in a complex {topic} problem?",
        ]
    return [
        "In {topic}, which option is most suitable for {focus}?",
        "For {topic}, select the best option to address {focus}.",
        "Which choice best applies {topic} concepts to {focus}?",
    ]


def _option_bundle(topic: str, focus: str, difficulty: str) -> tuple[str, list[str]]:
    correct = f"Applies {topic} principles correctly to handle {focus}."
    distractors = [
        f"Uses a method unrelated to {topic} and ignores {focus}.",
        f"Partially applies {topic} but misses the key requirement in {focus}.",
        f"Overcomplicates {topic} and introduces assumptions not needed for {focus}.",
    ]
    if difficulty == "Hard":
        correct = f"Balances correctness, constraints, and efficiency in {topic} for {focus}."
    return correct, distractors


def _make_option_map(correct: str, distractors: list[str]) -> tuple[dict[str, str], str]:
    options = [correct] + distractors
    deduped = []
    seen = set()
    for option in options:
        key = option.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(option)
    while len(deduped) < 4:
        deduped.append(f"Alternative approach variant {len(deduped) + 1}")
    deduped = deduped[:4]
    random.shuffle(deduped)
    labels = ["A", "B", "C", "D"]
    option_map = {labels[idx]: deduped[idx] for idx in range(4)}
    correct_label = next(label for label, value in option_map.items() if value == correct)
    return option_map, correct_label


def _generate_ai_mcq_json(topics_text: str, difficulty: str, num_questions: int) -> list[dict]:
    topics = _parse_topics(topics_text)
    assigned_topics = _distributed_topics(topics, num_questions)
    templates = _difficulty_question_templates(difficulty)
    focus_pool = _difficulty_focus_pool(difficulty)

    used_questions = set()
    output = []
    for idx in range(num_questions):
        topic = assigned_topics[idx]
        generated = None
        for _ in range(12):
            focus = random.choice(focus_pool)
            template = random.choice(templates)
            question = template.format(topic=topic, focus=focus)
            if question.lower() in used_questions:
                question = f"{question} (Set {idx + 1})"
            correct, distractors = _option_bundle(topic, focus, difficulty)
            option_map, correct_label = _make_option_map(correct, distractors)
            candidate = {
                "topic": topic,
                "difficulty": difficulty,
                "question": question,
                "options": option_map,
                "correct_answer": correct_label,
            }
            q_key = candidate["question"].strip().lower()
            if q_key in used_questions:
                continue
            used_questions.add(q_key)
            generated = candidate
            break
        if generated is None:
            # fallback with guaranteed unique suffix
            focus = random.choice(focus_pool)
            correct, distractors = _option_bundle(topic, focus, difficulty)
            option_map, correct_label = _make_option_map(correct, distractors)
            generated = {
                "topic": topic,
                "difficulty": difficulty,
                "question": f"In {topic}, choose the best option for {focus} (Q{idx + 1}).",
                "options": option_map,
                "correct_answer": correct_label,
            }
        output.append(generated)
    return output


def _convert_ai_json_to_assessment_questions(ai_rows: list[dict], total_marks: float) -> list[dict]:
    marks_list = _question_marks(total_marks, len(ai_rows))
    out = []
    for idx, row in enumerate(ai_rows):
        option_map = row.get("options") or {}
        labels = ["A", "B", "C", "D"]
        ordered_options = [str(option_map.get(label, "")).strip() for label in labels]
        ordered_options = [item for item in ordered_options if item]
        correct_label = str(row.get("correct_answer") or "").strip().upper()
        correct_answer_text = str(option_map.get(correct_label, "")).strip() if correct_label else ""
        out.append(
            {
                "question_id": f"Q{idx + 1}",
                "type": "mcq",
                "question": str(row.get("question") or "").strip(),
                "options": ordered_options[:4],
                "correct_answer": correct_answer_text,
                "marks": marks_list[idx],
                "topic": str(row.get("topic") or "").strip(),
                "difficulty": str(row.get("difficulty") or "").strip(),
                "option_map": {k: v for k, v in option_map.items() if k in {"A", "B", "C", "D"}},
                "correct_answer_label": correct_label,
            }
        )
    return out


def _public_question(question: dict) -> dict:
    return {
        "question_id": question.get("question_id"),
        "type": question.get("type"),
        "question": question.get("question"),
        "options": question.get("options", []),
        "marks": question.get("marks", 0),
    }


def _score_descriptive(question_text: str, response_text: str, max_marks: float) -> float:
    response_tokens = {
        token.lower().strip(".,!?;:()[]{}")
        for token in response_text.split()
        if token and token.lower() not in STOPWORDS
    }
    prompt_tokens = {
        token.lower().strip(".,!?;:()[]{}")
        for token in question_text.split()
        if token and token.lower() not in STOPWORDS
    }
    if not response_tokens or not prompt_tokens:
        return 0.0
    overlap = len(response_tokens.intersection(prompt_tokens))
    ratio = min(1.0, overlap / max(1, len(prompt_tokens) // 4))
    return round(max_marks * ratio, 2)


def _student_attempt_doc(assessment_id: str, user: dict) -> dict | None:
    return attempts_collection.find_one(
        {
            "assessment_id": assessment_id,
            "student_username": user.get("username"),
        }
    )


def _compute_subject_performance(student_id: str, class_name: str, section: str) -> list[dict]:
    pipeline = [
        {
            "$match": {
                "class_name": class_name,
                "section": section,
                "student_id": student_id,
            }
        },
        {
            "$group": {
                "_id": "$subject_code",
                "obtained": {
                    "$sum": {
                        "$convert": {
                            "input": "$obtained_marks",
                            "to": "double",
                            "onError": 0.0,
                            "onNull": 0.0,
                        }
                    }
                },
                "maximum": {
                    "$sum": {
                        "$convert": {
                            "input": "$max_marks",
                            "to": "double",
                            "onError": 0.0,
                            "onNull": 0.0,
                        }
                    }
                },
                "entries": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    rows = []
    for item in subject_marks_collection.aggregate(pipeline):
        percentage = round((item["obtained"] / item["maximum"]) * 100, 2) if item["maximum"] else 0.0
        rows.append(
            {
                "subject_code": item.get("_id"),
                "percentage": percentage,
                "entries": item.get("entries", 0),
            }
        )
    return rows


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


def _weak_topics_for_student(user: dict) -> list[dict]:
    rows = list(
        attempts_collection.find(
            {
                "student_username": user.get("username"),
                "status": {"$in": ["submitted", "auto_locked"]},
            },
            {"_id": 0, "topic": 1, "score_percentage": 1, "assessment_id": 1, "submitted_at": 1},
        ).sort("submitted_at", -1)
    )
    topic_stats = {}
    for row in rows:
        topic = str(row.get("topic") or "General").strip() or "General"
        val = float(row.get("score_percentage", 0))
        bucket = topic_stats.setdefault(topic, [])
        bucket.append(val)

    weak = []
    for topic, values in topic_stats.items():
        avg = round(mean(values), 2) if values else 0.0
        if avg < POOR_TOPIC_THRESHOLD:
            weak.append({"topic": topic, "average_score": avg})

    weak.sort(key=lambda item: item["average_score"])
    return weak


def _resource_key(topic: str) -> str:
    t = topic.lower()
    for key in RESOURCE_LIBRARY.keys():
        if key != "default" and key in t:
            return key
    return "default"


def _store_recommendations(user: dict, weak_topics: list[dict]) -> list[dict]:
    recommendations = []
    for topic_info in weak_topics:
        topic = topic_info["topic"]
        links = RESOURCE_LIBRARY[_resource_key(topic)][:3]
        recommendations.append({"topic": topic, "resources": links})
        recommendations_collection.insert_one(
            {
                "student_username": user.get("username"),
                "topic": topic,
                "average_score": topic_info.get("average_score", 0),
                "resources": links,
                "created_at": datetime.utcnow().isoformat(),
            }
        )
    return recommendations


@router.post("/teacher/generate")
def generate_assessment(payload: AssessmentGenerateIn, user=Depends(require_teacher)):
    _ensure_assigned(user, payload.class_name, payload.section)
    ai_json_rows = _generate_ai_mcq_json(
        topics_text=payload.topic,
        difficulty=payload.difficulty,
        num_questions=payload.number_of_questions,
    )
    questions = _convert_ai_json_to_assessment_questions(ai_json_rows, payload.total_marks)

    now = datetime.utcnow().isoformat()
    doc = {
        "title": payload.title.strip(),
        "teacher_username": user.get("username"),
        "class_name": payload.class_name,
        "section": payload.section,
        "subject_code": payload.subject_code.strip(),
        "topic": payload.topic.strip(),
        "difficulty": payload.difficulty,
        "total_questions": payload.number_of_questions,
        "total_marks": payload.total_marks,
        "questions": questions,
        "ai_generated_json": ai_json_rows,
        "status": "draft",
        "is_locked": False,
        "created_at": now,
        "updated_at": now,
    }
    result = assessments_collection.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    return doc


@router.post("/teacher/generate-mcq-json")
def generate_mcq_json(payload: AssessmentGenerateIn, user=Depends(require_teacher)):
    _ensure_assigned(user, payload.class_name, payload.section)
    return _generate_ai_mcq_json(
        topics_text=payload.topic,
        difficulty=payload.difficulty,
        num_questions=payload.number_of_questions,
    )


@router.put("/teacher/{assessment_id}")
def edit_assessment(assessment_id: str, payload: AssessmentEditIn, user=Depends(require_teacher)):
    doc = _assessment_for_teacher(assessment_id, user)
    if doc.get("is_locked"):
        raise HTTPException(status_code=400, detail="Locked assessment cannot be edited")

    updates = {"updated_at": datetime.utcnow().isoformat()}
    if payload.title is not None:
        updates["title"] = payload.title.strip()
    if payload.questions is not None:
        updates["questions"] = [q.model_dump() for q in payload.questions]
        updates["total_questions"] = len(payload.questions)
        updates["total_marks"] = round(sum(float(q.marks) for q in payload.questions), 2)

    assessments_collection.update_one({"_id": doc["_id"]}, {"$set": updates})
    return {"message": "Assessment updated"}


@router.get("/teacher")
def list_teacher_assessments(
    class_name: str | None = Query(None),
    section: str | None = Query(None),
    status: str | None = Query(None),
    user=Depends(require_teacher),
):
    query = {"teacher_username": user.get("username")}
    if class_name:
        query["class_name"] = class_name
    if section:
        query["section"] = section
    if status:
        query["status"] = status

    rows = list(assessments_collection.find(query).sort("updated_at", -1).limit(300))
    out = []
    for row in rows:
        row["id"] = str(row.pop("_id"))
        out.append(row)
    return out


@router.post("/teacher/{assessment_id}/publish")
def publish_assessment(assessment_id: str, user=Depends(require_teacher)):
    doc = _assessment_for_teacher(assessment_id, user)
    if doc.get("is_locked"):
        raise HTTPException(status_code=400, detail="Assessment is already locked")

    now = datetime.utcnow().isoformat()
    assessments_collection.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "published", "published_at": now, "updated_at": now}},
    )
    return {"message": "Assessment published"}


@router.post("/teacher/{assessment_id}/lock")
def lock_assessment(assessment_id: str, user=Depends(require_teacher)):
    doc = _assessment_for_teacher(assessment_id, user)
    now = datetime.utcnow().isoformat()
    assessments_collection.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "locked", "is_locked": True, "locked_at": now, "updated_at": now}},
    )
    return {"message": "Assessment locked"}


@router.delete("/teacher/{assessment_id}")
def delete_assessment(assessment_id: str, user=Depends(require_teacher)):
    doc = _assessment_for_teacher(assessment_id, user)
    attempts_collection.delete_many({"assessment_id": str(doc["_id"])})
    assessments_collection.delete_one({"_id": doc["_id"]})
    return {"message": "Assessment deleted"}


@router.get("/teacher/{assessment_id}/attempts")
def teacher_assessment_attempts(assessment_id: str, user=Depends(require_teacher)):
    doc = _assessment_for_teacher(assessment_id, user)
    rows = list(
        attempts_collection.find(
            {"assessment_id": str(doc["_id"])},
            {"_id": 0},
        ).sort("submitted_at", -1)
    )
    return rows


@router.get("/student")
def list_student_assessments(user=Depends(require_student)):
    class_name = user.get("class_name")
    section = user.get("section")
    if not class_name or not section:
        return []

    rows = list(
        assessments_collection.find(
            {
                "class_name": class_name,
                "section": section,
                "status": "published",
                "is_locked": False,
            }
        ).sort("published_at", -1)
    )
    out = []
    for row in rows:
        attempt = _student_attempt_doc(str(row["_id"]), user)
        out.append(
            {
                "id": str(row["_id"]),
                "title": row.get("title"),
                "topic": row.get("topic"),
                "difficulty": row.get("difficulty"),
                "subject_code": row.get("subject_code"),
                "total_questions": row.get("total_questions", 0),
                "total_marks": row.get("total_marks", 0),
                "attempt_status": attempt.get("status") if attempt else "not_started",
            }
        )
    return out


@router.post("/student/{assessment_id}/start")
def start_assessment(assessment_id: str, user=Depends(require_student)):
    if not ObjectId.is_valid(assessment_id):
        raise HTTPException(status_code=400, detail="Invalid assessment id")
    assessment = assessments_collection.find_one({"_id": ObjectId(assessment_id)})
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if assessment.get("class_name") != user.get("class_name") or assessment.get("section") != user.get("section"):
        raise HTTPException(status_code=403, detail="Assessment not available for this student")
    if assessment.get("status") != "published" or assessment.get("is_locked"):
        raise HTTPException(status_code=400, detail="Assessment is not open")

    existing = _student_attempt_doc(assessment_id, user)
    if existing and existing.get("status") in {"submitted", "auto_locked", "locked"}:
        raise HTTPException(status_code=400, detail="You can attempt this assessment only once")
    if existing:
        return {"message": "Attempt resumed", "attempt_status": existing.get("status")}

    now = datetime.utcnow().isoformat()
    attempts_collection.insert_one(
        {
            "assessment_id": assessment_id,
            "student_username": user.get("username"),
            "student_id": str(user.get("roll_no") or user.get("username") or ""),
            "class_name": user.get("class_name"),
            "section": user.get("section"),
            "topic": assessment.get("topic"),
            "answers": [],
            "score": 0.0,
            "score_percentage": 0.0,
            "status": "in_progress",
            "tab_violations": 0,
            "created_at": now,
            "updated_at": now,
        }
    )
    return {"message": "Attempt started", "attempt_status": "in_progress"}


@router.get("/student/{assessment_id}")
def get_assessment_for_student(assessment_id: str, user=Depends(require_student)):
    if not ObjectId.is_valid(assessment_id):
        raise HTTPException(status_code=400, detail="Invalid assessment id")
    assessment = assessments_collection.find_one({"_id": ObjectId(assessment_id)})
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if assessment.get("class_name") != user.get("class_name") or assessment.get("section") != user.get("section"):
        raise HTTPException(status_code=403, detail="Assessment not available for this student")

    attempt = _student_attempt_doc(assessment_id, user)
    if attempt and attempt.get("status") in {"submitted", "auto_locked", "locked"}:
        raise HTTPException(status_code=400, detail="Attempt already finished")
    if assessment.get("status") != "published" or assessment.get("is_locked"):
        raise HTTPException(status_code=400, detail="Assessment is not open")

    return {
        "id": str(assessment["_id"]),
        "title": assessment.get("title"),
        "topic": assessment.get("topic"),
        "difficulty": assessment.get("difficulty"),
        "subject_code": assessment.get("subject_code"),
        "total_marks": assessment.get("total_marks"),
        "questions": [_public_question(q) for q in assessment.get("questions", [])],
    }


@router.post("/student/{assessment_id}/tab-violation")
def report_tab_violation(assessment_id: str, payload: TabViolationIn, user=Depends(require_student)):
    attempt = _student_attempt_doc(assessment_id, user)
    if not attempt:
        raise HTTPException(status_code=404, detail="No active attempt found")
    if attempt.get("status") != "in_progress":
        raise HTTPException(status_code=400, detail="Attempt is not active")

    next_count = int(attempt.get("tab_violations", 0)) + 1
    now = datetime.utcnow().isoformat()
    updates = {
        "tab_violations": next_count,
        "last_violation_reason": payload.reason,
        "updated_at": now,
    }
    status = "in_progress"

    if next_count >= MAX_TAB_VIOLATIONS:
        status = "auto_locked"
        updates.update(
            {
                "status": status,
                "locked_at": now,
                "submitted_at": now,
                "auto_lock_reason": "tab_switch_limit_reached",
            }
        )

    attempts_collection.update_one({"_id": attempt["_id"]}, {"$set": updates})
    return {
        "message": "Violation recorded",
        "tab_violations": next_count,
        "status": status,
        "auto_locked": status == "auto_locked",
    }


@router.post("/student/{assessment_id}/submit")
def submit_assessment(assessment_id: str, payload: AssessmentSubmitIn, user=Depends(require_student)):
    if not ObjectId.is_valid(assessment_id):
        raise HTTPException(status_code=400, detail="Invalid assessment id")
    assessment = assessments_collection.find_one({"_id": ObjectId(assessment_id)})
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    attempt = _student_attempt_doc(assessment_id, user)
    if not attempt:
        raise HTTPException(status_code=400, detail="Start assessment before submission")
    if attempt.get("status") in {"submitted", "auto_locked", "locked"}:
        raise HTTPException(status_code=400, detail="Attempt already closed")

    response_map = {
        str(item.question_id): str(item.response or "").strip()
        for item in payload.answers
    }

    graded = []
    score = 0.0
    for question in assessment.get("questions", []):
        q_id = str(question.get("question_id"))
        q_type = question.get("type")
        q_marks = float(question.get("marks", 0))
        response = response_map.get(q_id, "")
        awarded = 0.0
        is_correct = None

        if q_type == "mcq":
            correct = str(question.get("correct_answer") or "").strip().lower()
            selected = response.strip().lower()
            is_correct = bool(correct and selected == correct)
            awarded = q_marks if is_correct else 0.0
        else:
            awarded = _score_descriptive(str(question.get("question", "")), response, q_marks)

        awarded = round(min(max(awarded, 0.0), q_marks), 2)
        score += awarded
        graded.append(
            {
                "question_id": q_id,
                "type": q_type,
                "response": response,
                "max_marks": q_marks,
                "awarded_marks": awarded,
                "is_correct": is_correct,
            }
        )

    total_marks = float(assessment.get("total_marks", 0))
    percentage = round((score / total_marks) * 100, 2) if total_marks else 0.0
    now = datetime.utcnow().isoformat()

    attempts_collection.update_one(
        {"_id": attempt["_id"]},
        {
            "$set": {
                "answers": graded,
                "score": round(score, 2),
                "score_percentage": percentage,
                "status": "submitted",
                "submitted_at": now,
                "updated_at": now,
                "topic": assessment.get("topic"),
                "subject_code": assessment.get("subject_code"),
            }
        },
    )

    return {
        "message": "Assessment submitted",
        "score": round(score, 2),
        "total_marks": total_marks,
        "score_percentage": percentage,
    }


@router.get("/student/analytics/overview")
def student_ai_analytics(user=Depends(require_student)):
    student_id = str(user.get("roll_no") or user.get("username") or "")
    class_name = str(user.get("class_name") or "")
    section = str(user.get("section") or "")
    if not student_id or not class_name or not section:
        raise HTTPException(status_code=400, detail="Student profile is incomplete")

    subject_rows = _compute_subject_performance(student_id, class_name, section)
    weak_topics = _weak_topics_for_student(user)

    subject_avg = round(mean([row["percentage"] for row in subject_rows]), 2) if subject_rows else 0.0

    attempt_rows = list(
        attempts_collection.find(
            {
                "student_username": user.get("username"),
                "status": {"$in": ["submitted", "auto_locked"]},
            },
            {"_id": 0, "score_percentage": 1},
        )
    )
    assessment_avg = round(mean([float(item.get("score_percentage", 0)) for item in attempt_rows]), 2) if attempt_rows else 0.0
    attendance_pct = _attendance_percentage(student_id, class_name, section)

    readiness = round((subject_avg * 0.5) + (assessment_avg * 0.3) + (attendance_pct * 0.2), 2)

    gap_analysis = []
    if subject_avg < 60:
        gap_analysis.append("Low subject-wise marks trend")
    if assessment_avg < 60:
        gap_analysis.append("Low assessment performance trend")
    if attendance_pct < 75:
        gap_analysis.append("Attendance gap impacting readiness")
    if weak_topics:
        gap_analysis.append("Topic-level conceptual weakness detected")

    recommendations = _store_recommendations(user, weak_topics) if weak_topics else []

    return {
        "subject_wise_performance": subject_rows,
        "weak_topics": weak_topics,
        "readiness_percentage": readiness,
        "industry_readiness_score": readiness,
        "gap_analysis": gap_analysis,
        "recommendations": recommendations,
    }


@router.get("/student/recommendations/history")
def recommendation_history(user=Depends(require_student)):
    rows = list(
        recommendations_collection.find(
            {"student_username": user.get("username")},
            {"_id": 0},
        ).sort("created_at", -1).limit(200)
    )
    return rows
