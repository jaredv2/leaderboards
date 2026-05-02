from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from backend.config import settings
from backend.database import db
from typing import Optional


security = HTTPBearer()


async def get_current_user(credentials: HTTPAuthorizationCredentials, request: Request) -> dict:
    """Verify JWT token and return current user"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        discord_id: str = payload.get("sub")
        
        if discord_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            )
        
        user = await db.fetch_one(
            "SELECT * FROM users WHERE discord_id = ?",
            (discord_id,)
        )
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        if user.get("is_banned"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is banned"
            )
        
        # Update last active
        await db.execute(
            "UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?",
            (user["id"],)
        )
        
        request.state.user = user
        return user
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )


async def require_auth(request: Request):
    """Middleware to require authentication"""
    credentials: HTTPAuthorizationCredentials = await security(request)
    await get_current_user(credentials, request)
