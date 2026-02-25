from fastapi import Depends, HTTPException, status
from utils.jwt_utils import verify_token

def require_role(required_role: str):
    def role_checker(payload: dict = Depends(verify_token)):
        if payload.get("role") != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
        return payload
    return role_checker
