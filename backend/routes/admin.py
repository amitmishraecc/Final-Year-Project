from fastapi import APIRouter, Depends, HTTPException
from database import attendance_collection, db, users_collection
from utils.security import require_admin, hash_password
from utils.dummy_seed import seed_dummy_data
from pydantic import BaseModel
from bson import ObjectId

router = APIRouter(prefix="/admin", tags=["Admin"])
performance_collection = db["performance_records"]


# -------------------------
# Models
# -------------------------

class CreateUserModel(BaseModel):
    username: str
    password: str
    role: str  # teacher | student
    assigned_class: str | None = None


class AssignClassModel(BaseModel):
    teacher_username: str
    class_name: str


# -------------------------
# Create Teacher / Student
# -------------------------
@router.post("/create-teacher")
def create_teacher(data: dict, admin=Depends(require_admin)):

    if users_collection.find_one({"username": data["username"]}):
        return {"error": "User exists"}

    users_collection.insert_one({
        "username": data["username"],
        "password": hash_password(data["password"]),
        "role": "teacher",
        "assigned_classes": []
    })

    return {"message": "Teacher created"}

# @router.post("/create-user")
# def create_user(data: CreateUserModel, admin=Depends(require_admin)):

#     if users_collection.find_one({"username": data.username}):
#         raise HTTPException(status_code=400, detail="User already exists")

#     users_collection.insert_one({
#         "username": data.username,
#         "password": hash_password(data.password),
#         "role": data.role,
#         "assigned_class": data.assigned_class
#     })

#     return {"message": f"{data.role} created successfully"}


# -------------------------
# Get All Users
# -------------------------

# @router.get("/users")
# def get_all_users(admin=Depends(require_admin)):
#     users = list(users_collection.find({}, {"_id": 0}))
#     return users


@router.get("/teachers")
def get_teachers(admin=Depends(require_admin)):
    teachers = list(
        users_collection.find(
            {"role": "teacher"},
            {"_id": 0, "password": 0}
        )
    )
    return teachers


@router.get("/students")
def get_students(admin=Depends(require_admin)):
    students = list(
        users_collection.find(
            {"role": "student"},
            {"_id": 0, "password": 0}
        )
    )
    return students


@router.post("/create-student")
def create_student(data: dict, admin=Depends(require_admin)):
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()
    roll_no = str(data.get("roll_no", "")).strip()
    class_name = str(data.get("class_name", "")).strip()
    section = str(data.get("section", "")).strip()
    name = str(data.get("name", "")).strip()

    if not username or not password or not roll_no or not class_name or not section:
        raise HTTPException(status_code=400, detail="username, password, roll_no, class_name and section are required")

    if users_collection.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="User exists")

    users_collection.insert_one({
        "username": username,
        "password": hash_password(password),
        "role": "student",
        "roll_no": roll_no,
        "name": name or username,
        "class_name": class_name,
        "section": section
    })

    return {"message": "Student created"}


@router.put("/update-student/{username}")
def update_student(username: str, data: dict, admin=Depends(require_admin)):
    user = users_collection.find_one({"username": username, "role": "student"})
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")

    allowed_fields = {"name", "roll_no", "class_name", "section", "password"}
    update_data = {}
    for key, value in data.items():
        if key in allowed_fields and value is not None:
            update_data[key] = value

    if "password" in update_data:
        update_data["password"] = hash_password(str(update_data["password"]))

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    users_collection.update_one({"username": username}, {"$set": update_data})
    return {"message": "Student updated"}

# -------------------------
# Assign Class To Teacher
# -------------------------

@router.put("/assign-class/{username}")
def assign_class(username: str, data: dict, admin=Depends(require_admin)):

    user = users_collection.find_one({"username": username.strip()})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    users_collection.update_one(
        {"username": username},
        {"$set": {
            "class_name": data.get("class_name"),
            "section": data.get("section")
        }}
    )

    return {"message": "Class assigned successfully"}


# -------------------------
# Delete User
# -------------------------

@router.delete("/delete/{username}")
def delete_user(username: str, admin=Depends(require_admin)):

    result = users_collection.delete_one({"username": username})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"message": "User deleted successfully"}









# from fastapi import APIRouter, Depends
# from database import users_collection
# from utils.roles import require_admin
# from utils.security import hash_password
# from pydantic import BaseModel
# from bson import ObjectId
# router = APIRouter(prefix="/admin", tags=["Admin"])


# @router.get("/teachers")
# def get_teachers(admin=Depends(require_admin)):
#     teachers = list(
#         users_collection.find(
#             {"role": "teacher"},
#             {"_id": 0, "password": 0}
#         )
#     )
#     return teachers




@router.post("/assign-class")
def assign_class(data: dict, admin=Depends(require_admin)):

    users_collection.update_one(
        {"username": data["username"]},
        {
            "$push": {
                "assigned_classes": {
                    "class_name": data["class_name"],
                    "section": data["section"]
                }
            }
        }
    )

    return {"message": "Class assigned"}


@router.post("/seed-dummy-data")
def seed_dummy(admin=Depends(require_admin)):
    try:
        return seed_dummy_data()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/student-dashboard/{username}")
def get_student_dashboard_snapshot(username: str, admin=Depends(require_admin)):
    student = users_collection.find_one(
        {"username": username, "role": "student"},
        {"_id": 0, "password": 0},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    student_id = str(student.get("roll_no") or student.get("username") or "")
    if not student_id:
        raise HTTPException(status_code=400, detail="Student identifier missing")

    records = list(
        performance_collection.find({"student_id": student_id}, {"_id": 0})
    )
    count = len(records)
    avg_marks = round(sum(float(r.get("marks", 0)) for r in records) / count, 2) if count else 0
    avg_assignment = round(sum(float(r.get("assignment_score", 0)) for r in records) / count, 2) if count else 0
    avg_co = round(sum(float(r.get("co_curricular_score", 0)) for r in records) / count, 2) if count else 0

    attendance_pipeline = [
        {"$unwind": "$records"},
        {
            "$match": {
                "$or": [
                    {"records.student_id": student_id},
                    {"records.roll_no": student_id},
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
    attendance_history = list(attendance_collection.aggregate(attendance_pipeline))
    total_classes = len(attendance_history)
    present_count = sum(1 for item in attendance_history if str(item.get("status", "")).lower() == "present")
    attendance_percentage = round((present_count / total_classes) * 100, 2) if total_classes else 0

    weighted_score = round(
        attendance_percentage * 0.30 + avg_marks * 0.40 + avg_assignment * 0.20 + avg_co * 0.10, 2
    )
    if weighted_score >= 85:
        grade = "A"
    elif weighted_score >= 70:
        grade = "B"
    elif weighted_score >= 55:
        grade = "C"
    elif weighted_score >= 40:
        grade = "D"
    else:
        grade = "F"

    return {
        "student": student,
        "overview": {
            "attendance_percentage": attendance_percentage,
            "average_marks": avg_marks,
            "average_assignment_score": avg_assignment,
            "average_co_curricular_score": avg_co,
            "weighted_score": weighted_score,
            "grade": grade,
        },
        "attendance_history": attendance_history[:20],
    }

