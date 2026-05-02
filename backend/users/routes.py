from fastapi import APIRouter, HTTPException, status, Request, Depends
from pydantic import BaseModel, Field
from typing import List
from backend.database import db
from backend.models import User, ReportCreate, Report
from backend.auth.routes import verify_token
from backend.profile_helpers import serialize_user


router = APIRouter(prefix="/users", tags=["users"])


class UserProfileUpdate(BaseModel):
    bio: str = Field("", max_length=280)
    show_activity: bool = True


class StatusRequestCreate(BaseModel):
    request: str = Field(..., min_length=3, max_length=500)


async def calculate_user_reputation(user_id: int) -> float:
    """Score user reputation on a -100 to 100 scale from participation quality."""
    stats = await db.fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM votes WHERE user_id = ?) as votes_cast,
          (SELECT COUNT(*) FROM leaderboards WHERE creator_id = ? AND is_active = 1) as leaderboards_created,
          (SELECT COUNT(*) FROM options o JOIN leaderboards l ON l.id = o.leaderboard_id WHERE l.creator_id = ?) as options_on_owned,
          (SELECT COUNT(*) FROM votes v JOIN leaderboards l ON l.id = v.leaderboard_id WHERE l.creator_id = ?) as votes_received,
          (
            SELECT COUNT(*) FROM reports r
            LEFT JOIN leaderboards rl ON r.content_type = 'leaderboard' AND rl.id = r.content_id
            LEFT JOIN options ro ON r.content_type = 'option' AND ro.id = r.content_id
            LEFT JOIN leaderboards rol ON rol.id = ro.leaderboard_id
            WHERE COALESCE(rl.creator_id, rol.creator_id) = ?
              AND r.status IN ('open','investigating')
          ) as open_reports,
          (
            SELECT COUNT(*) FROM reports r
            LEFT JOIN leaderboards rl ON r.content_type = 'leaderboard' AND rl.id = r.content_id
            LEFT JOIN options ro ON r.content_type = 'option' AND ro.id = r.content_id
            LEFT JOIN leaderboards rol ON rol.id = ro.leaderboard_id
            WHERE COALESCE(rl.creator_id, rol.creator_id) = ?
              AND r.status = 'resolved'
          ) as resolved_reports
        """,
        (user_id, user_id, user_id, user_id, user_id, user_id),
    )
    if not stats:
        return 0.0
    raw = (
        min(stats["votes_cast"], 100) * 0.2
        + min(stats["leaderboards_created"], 30) * 1.2
        + min(stats["options_on_owned"], 200) * 0.15
        + min(stats["votes_received"], 300) * 0.18
        - min(stats["open_reports"], 20) * 2.5
        - min(stats["resolved_reports"], 20) * 1.0
    )
    return round(max(-100, min(100, raw)), 2)


@router.get("/{user_id}", response_model=User)
async def get_user(user_id: int):
    """Get a user by ID"""
    user = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return User(**(await serialize_user(user)))


@router.patch("/me", response_model=User)
async def update_my_profile(payload: UserProfileUpdate, user: dict = Depends(verify_token)):
    await db.execute(
        "UPDATE users SET bio = ?, show_activity = ? WHERE id = ?",
        (payload.bio.strip(), 1 if payload.show_activity else 0, user["id"])
    )
    updated = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))
    return User(**(await serialize_user(updated)))


@router.post("/me/status-requests")
async def create_status_request(
    payload: StatusRequestCreate,
    user: dict = Depends(verify_token),
):
    existing = await db.fetch_one(
        """
        SELECT id FROM status_requests
        WHERE user_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (user["id"],),
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a pending badge or status request."
        )

    cursor = await db.execute(
        """
        INSERT INTO status_requests (user_id, request)
        VALUES (?, ?)
        """,
        (user["id"], payload.request.strip()),
    )
    return {
        "id": cursor.lastrowid,
        "status": "pending",
        "message": "Request submitted for admin review.",
    }


@router.get("/{user_id}/leaderboards")
async def get_user_leaderboards(user_id: int):
    """Get all leaderboards created by a user"""
    leaderboards = await db.fetch_all(
        """
        SELECT l.*, 
               (SELECT COUNT(*) FROM votes WHERE leaderboard_id = l.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE leaderboard_id = l.id) as total_options
        FROM leaderboards l
        WHERE l.creator_id = ? AND l.is_active = 1
        ORDER BY l.created_at DESC
        """,
        (user_id,)
    )
    return leaderboards


@router.get("/{user_id}/votes")
async def get_user_vote_history(user_id: int, limit: int = 50):
    """Get vote history for a user, including option and leaderboard context."""
    user = await db.fetch_one("SELECT id, show_activity FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    votes = await db.fetch_all(
        """
        SELECT v.id,
               v.option_id,
               v.leaderboard_id,
               v.weight,
               v.created_at,
               o.name as option_name,
               o.image_url as option_image_url,
               l.title as leaderboard_title,
               l.creator_id as leaderboard_creator_id
        FROM votes v
        JOIN options o ON o.id = v.option_id
        JOIN leaderboards l ON l.id = v.leaderboard_id
        WHERE v.user_id = ?
          AND l.is_active = 1
        ORDER BY v.created_at DESC
        LIMIT ?
        """,
        (user_id, limit)
    )
    return votes


@router.get("/{user_id}/activity")
async def get_user_activity(user_id: int, limit: int = 50):
    """Get a combined profile activity feed for leaderboards and votes."""
    user = await db.fetch_one("SELECT id, show_activity FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if not user.get("show_activity", True):
        return []

    activity = await db.fetch_all(
        """
        SELECT 'vote_cast' as type,
               v.created_at as created_at,
               v.option_id as option_id,
               v.leaderboard_id as leaderboard_id,
               o.name as option_name,
               l.title as leaderboard_title,
               NULL as leaderboard_description
        FROM votes v
        JOIN options o ON o.id = v.option_id
        JOIN leaderboards l ON l.id = v.leaderboard_id
        WHERE v.user_id = ?
          AND l.is_active = 1

        UNION ALL

        SELECT 'leaderboard_created' as type,
               l.created_at as created_at,
               NULL as option_id,
               l.id as leaderboard_id,
               NULL as option_name,
               l.title as leaderboard_title,
               l.description as leaderboard_description
        FROM leaderboards l
        WHERE l.creator_id = ?
          AND l.is_active = 1

        ORDER BY created_at DESC
        LIMIT ?
        """,
        (user_id, user_id, limit)
    )
    return activity


@router.post("/{user_id}/report", response_model=Report, status_code=status.HTTP_201_CREATED)
async def report_user(
    user_id: int,
    report: ReportCreate,
    user: dict = Depends(verify_token),
):
    """Report a user profile."""
    target = await db.fetch_one("SELECT id FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if user["id"] == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot report your own profile"
        )

    cursor = await db.execute(
        """
        INSERT INTO reports (reporter_id, content_type, content_id, reason, description)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user["id"], "user", user_id, report.reason, report.description),
    )
    result = await db.fetch_one("SELECT * FROM reports WHERE id = ?", (cursor.lastrowid,))
    return Report(**result)


@router.get("/{user_id}/stats")
async def get_user_stats(user_id: int):
    """Get user statistics"""
    user = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Get additional stats
    leaderboard_count = await db.fetch_one(
        "SELECT COUNT(*) as count FROM leaderboards WHERE creator_id = ? AND is_active = 1",
        (user_id,)
    )
    
    vote_count = await db.fetch_one(
        "SELECT COUNT(*) as count FROM votes WHERE user_id = ?",
        (user_id,)
    )
    
    # Get votes received on user's leaderboards
    votes_received = await db.fetch_one(
        """
        SELECT COUNT(*) as count FROM votes v
        JOIN leaderboards l ON v.leaderboard_id = l.id
        WHERE l.creator_id = ?
        """,
        (user_id,)
    )
    
    reputation = await calculate_user_reputation(user_id)
    await db.execute(
        "UPDATE users SET reputation_score = ? WHERE id = ?",
        (reputation, user_id)
    )
    user["reputation_score"] = reputation
    return {
        "user": User(**(await serialize_user(user))),
        "leaderboards_created": leaderboard_count["count"],
        "total_votes_cast": vote_count["count"],
        "total_votes_received": votes_received["count"],
        "reputation_score": reputation
    }


@router.get("/top/creators")
async def get_top_creators(limit: int = 10):
    """Get top creators by leaderboard count"""
    creators = await db.fetch_all(
        """
        SELECT u.*, COUNT(l.id) as leaderboard_count
        FROM users u
        JOIN leaderboards l ON u.id = l.creator_id
        WHERE l.is_active = 1
        GROUP BY u.id
        ORDER BY leaderboard_count DESC
        LIMIT ?
        """,
        (limit,)
    )
    return creators


@router.get("/top/voters")
async def get_top_voters(limit: int = 10):
    """Get top voters by vote count"""
    voters = await db.fetch_all(
        """
        SELECT u.*, COUNT(v.id) as vote_count
        FROM users u
        JOIN votes v ON u.id = v.user_id
        GROUP BY u.id
        ORDER BY vote_count DESC
        LIMIT ?
        """,
        (limit,)
    )
    return voters
