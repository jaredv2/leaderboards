from fastapi import APIRouter, HTTPException, status, Request, Depends
from fastapi.responses import RedirectResponse
from jose import jwt, JWTError
import secrets
from datetime import datetime, timedelta
from backend.config import settings
from backend.database import db
from backend.models import User, UserCreate, Token
from backend.profile_helpers import serialize_user
import httpx


router = APIRouter(prefix="/auth", tags=["auth"])


DISCORD_API_URL = "https://discord.com/api/v10"


@router.get("/discord/login")
async def discord_login():
    """Redirect to Discord OAuth"""
    return RedirectResponse(
        f"https://discord.com/api/oauth2/authorize?"
        f"client_id={settings.DISCORD_CLIENT_ID}"
        f"&redirect_uri={settings.DISCORD_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=identify"
    )


@router.get("/discord/callback")
async def discord_callback(code: str):
    """Handle Discord OAuth callback"""
    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            f"{DISCORD_API_URL}/oauth2/token",
            data={
                "client_id": settings.DISCORD_CLIENT_ID,
                "client_secret": settings.DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        if token_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to exchange code for token"
            )
        
        token_data = token_response.json()
        access_token = token_data["access_token"]
        
        # Get user info from Discord
        user_response = await client.get(
            f"{DISCORD_API_URL}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
        if user_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to get user info"
            )
        
        discord_user = user_response.json()
        discord_id = discord_user["id"]
        username = discord_user["username"]
        avatar_url = f"https://cdn.discordapp.com/avatars/{discord_id}/{discord_user['avatar']}" if discord_user.get("avatar") else None
        
        # Check if user exists in DB
        user = await db.fetch_one(
            "SELECT * FROM users WHERE discord_id = ?",
            (discord_id,)
        )
        
        if not user:
            # Create new user with CSRF token
            csrf_token = secrets.token_hex(16)
            await db.execute(
                """
                INSERT INTO users (discord_id, username, avatar_url, csrf_token)
                VALUES (?, ?, ?, ?)
                """,
                (discord_id, username, avatar_url, csrf_token)
            )
            user = await db.fetch_one(
                "SELECT * FROM users WHERE discord_id = ?",
                (discord_id,)
            )
        else:
            # Update user info
            csrf_token = secrets.token_hex(16)
            await db.execute(
                """
                UPDATE users SET username = ?, avatar_url = ?, last_active = CURRENT_TIMESTAMP, csrf_token = ?
                WHERE discord_id = ?
                """,
                (username, avatar_url, csrf_token, discord_id)
            )
            user = await db.fetch_one(
                "SELECT * FROM users WHERE discord_id = ?",
                (discord_id,)
            )
        
        # Create JWT token
        access_token = jwt.encode(
            {
                "sub": user["discord_id"],
                "exp": datetime.utcnow() + timedelta(days=7)
            },
            settings.SECRET_KEY,
            algorithm="HS256"
        )
        
        # Redirect to frontend with token and CSRF token
        csrf_token = user.get("csrf_token")
        return RedirectResponse(
            f"/?token={access_token}&csrf_token={csrf_token}",
            status_code=302
        )


async def verify_token(request: Request):
    """Verify JWT token from Authorization header"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header"
        )
    
    token = auth_header.split(" ")[1]
    
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        discord_id: str = payload.get("sub")
        
        if discord_id is None:
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
        
        return user
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )


# Export for use in other routes
def get_verified_user(user: dict = Depends(verify_token)):
    """Dependency to require authentication"""
    return user


@router.get("/me", response_model=User)
async def get_current_user(user: dict = Depends(get_verified_user)):
    """Get current authenticated user"""
    return User(**(await serialize_user(user)))


@router.post("/logout")
async def logout():
    """Logout (client-side token removal)"""
    return {"message": "Logged out successfully"}
