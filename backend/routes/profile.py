from fastapi import APIRouter, Depends
from pydantic import BaseModel

from database import users_collection
from utils.security import get_current_user

router = APIRouter(prefix="/profile", tags=["Profile"])


class UpdateProfileIn(BaseModel):
    name: str | None = None
    profile_image: str | None = None


def _public_profile(user: dict) -> dict:
    return {
        "username": user.get("username"),
        "role": user.get("role"),
        "name": user.get("name", ""),
        "roll_no": user.get("roll_no"),
        "class_name": user.get("class_name"),
        "section": user.get("section"),
        "profile_image": user.get("profile_image", ""),
    }


@router.get("/me")
def get_my_profile(user=Depends(get_current_user)):
    return _public_profile(user)


@router.put("/me")
def update_my_profile(payload: UpdateProfileIn, user=Depends(get_current_user)):
    updates = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.profile_image is not None:
        updates["profile_image"] = payload.profile_image.strip()

    if updates:
        users_collection.update_one({"username": user["username"]}, {"$set": updates})
        user = users_collection.find_one({"username": user["username"]})

    return _public_profile(user)
