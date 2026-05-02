from fastapi import Request, HTTPException, status
from datetime import datetime, timedelta
from backend.database import db
from jose import jwt, JWTError
from backend.config import settings
from typing import Optional


RATE_LIMITS = {
    "vote": {"max": 10, "window": 60},  # 10 votes per minute
    "create_leaderboard": {"max": 3, "window": 3600},  # 3 per hour
    "create_option": {"max": 20, "window": 3600},  # 20 per hour
    "search": {"max": 30, "window": 60},  # 30 searches per minute
}


async def check_rate_limit(user_id: Optional[int], ip_address: str, action: str) -> bool:
    """Check if user/IP has exceeded rate limit for an action"""
    if action not in RATE_LIMITS:
        return True
    
    limit_config = RATE_LIMITS[action]
    max_requests = limit_config["max"]
    window_seconds = limit_config["window"]
    
    window_start = datetime.now() - timedelta(seconds=window_seconds)
    
    # Clean old entries
    await db.execute(
        "DELETE FROM rate_limits WHERE window_start < ?",
        (window_start,)
    )
    
    # Count requests in window
    if user_id:
        count_query = """
            SELECT COUNT(*) as count FROM rate_limits 
            WHERE user_id = ? AND action = ? AND window_start >= ?
        """
        params = (user_id, action, window_start)
    else:
        count_query = """
            SELECT COUNT(*) as count FROM rate_limits 
            WHERE ip_address = ? AND action = ? AND window_start >= ?
        """
        params = (ip_address, action, window_start)
    
    result = await db.fetch_one(count_query, params)
    count = result["count"] if result else 0
    
    if count >= max_requests:
        return False
    
    # Record this request
    await db.execute(
        """
        INSERT INTO rate_limits (user_id, ip_address, action, window_start)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (user_id, ip_address, action)
    )
    
    return True


async def rate_limit_middleware(request: Request, call_next):
    """Rate limiting middleware"""
    # Get user if authenticated
    user_id = None
    auth_header = request.headers.get("Authorization")
    
    if auth_header and auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1]
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
            discord_id = payload.get("sub")
            
            if discord_id:
                user = await db.fetch_one(
                    "SELECT * FROM users WHERE discord_id = ?",
                    (discord_id,)
                )
                if user:
                    user_id = user["id"]
        except (JWTError, IndexError):
            pass
    
    # Get IP address
    ip_address = request.client.host if request.client else "unknown"
    
    # Determine action based on path
    path = request.url.path
    action = None
    
    if "/votes" in path and request.method == "POST":
        action = "vote"
    elif "/leaderboards" in path and request.method == "POST":
        action = "create_leaderboard"
    elif "/options" in path and request.method == "POST":
        action = "create_option"
    elif "/search" in path:
        action = "search"
    
    if action:
        allowed = await check_rate_limit(user_id, ip_address, action)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for {action}"
            )
    
    response = await call_next(request)
    return response
