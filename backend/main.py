from fastapi import FastAPI
from routes import academic, auth, admin, profile, teacher, student, performance, sheets, notices, ai, interventions, assessments, calendar_events
from fastapi.middleware.cors import CORSMiddleware
from routes.admin import router as admin_router

app = FastAPI()



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(teacher.router)
app.include_router(student.router)
app.include_router(performance.router)
app.include_router(sheets.router)
app.include_router(academic.router)
app.include_router(profile.router)
app.include_router(notices.router)
app.include_router(ai.router)
app.include_router(interventions.router)
app.include_router(assessments.router)
app.include_router(calendar_events.router)


@app.get("/")
def root():
    return {"message": "Student Performance System Running"}


# from fastapi import FastAPI
# from routes.auth import router as auth_router
# from routes.teacher import router as teacher_router
# from routes.student import router as student_router
# from routes.admin import router as admin_router

# from fastapi.middleware.cors import CORSMiddleware

# app = FastAPI()

# app.include_router(auth_router)
# app.include_router(teacher_router)
# app.include_router(student_router)
# app.include_router(admin_router)

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["http://localhost:5173"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# @app.get("/")
# def home():
#     return {"message": "Student Performance Analysis System API Running"}


