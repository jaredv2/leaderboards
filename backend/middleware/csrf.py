from fastapi import Request, HTTPException, status
from jose import JWTError, jwt
from backend.config import settings
from backend.database import db

"""CSRF protection middleware.

- For mutating requests (POST/PUT/PATCH/DELETE) ensure:
- The Authorization header contains a valid JWT for an existing user.
- The request includes a valid X-CSRF-Token header matching the user's csrf_token.
"""


ALLOWED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def csrf_middleware(request: Request, call_next):
    # Only protect state-changing API calls under /api
    if request.method in ALLOWED_METHODS:
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required"
            )
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
            discord_id: str = payload.get("sub")
            if not discord_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token"
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
            csrf_token = request.headers.get("X-CSRF-Token")
            if not csrf_token or csrf_token != user.get("csrf_token"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid CSRF token"
                )
            request.state.user = user
        except JWTError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            )

    response = await call_next(request)
    return response
