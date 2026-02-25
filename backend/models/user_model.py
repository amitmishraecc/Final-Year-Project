from pydantic import BaseModel
from typing import Optional

class UserRegister(BaseModel):
    username: str
    password: str
    role: str
    class_name: Optional[str] = None
    section: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str
