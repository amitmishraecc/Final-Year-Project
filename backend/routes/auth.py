from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from database import users_collection
from utils.security import hash_password, verify_password, create_access_token
from fastapi import Depends
from fastapi.security import OAuth2PasswordRequestForm

router = APIRouter(prefix="/auth", tags=["Auth"])

class RegisterModel(BaseModel):
    username: str
    password: str
    role: str  # student | teacher

# class LoginModel(BaseModel):
#     username: str
#     password: str

@router.post("/register")
def register(user: RegisterModel):
    if users_collection.find_one({"username": user.username}):
        raise HTTPException(status_code=400, detail="User already exists")

    users_collection.insert_one({
        "username": user.username,
        "password": hash_password(user.password),
        "role": user.role
    })

    return {"message": "User registered successfully"}


@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = users_collection.find_one({"username": form_data.username})

    if not user or not verify_password(form_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({
        "sub": user["username"],
        "role": user["role"]
    })

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"]
    }
