from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Optional
from pydantic import BaseModel, Field
from backend.database import db
from backend.auth.routes import verify_token
from backend.models import Report, AdminAction, Category, Leaderboard, Option
from backend.config import settings
from backend.profile_helpers import BADGE_DEFINITIONS, normalize_badge_id, serialize_user
from datetime import datetime


router = APIRouter(prefix="/admin", tags=["admin"])


class BanRequest(BaseModel):
    reason: str = ""


class StatusRequestReview(BaseModel):
    status: str
    reason: str = ""
    action_type: Optional[str] = Field(None, pattern="^(status|badge)$")
    profile_status: Optional[str] = Field(None, max_length=80)
    badge_id: Optional[str] = Field(None, max_length=50)


class UserProfileAdminUpdate(BaseModel):
    profile_status: Optional[str] = Field(None, max_length=80)
    badge_id: Optional[str] = Field(None, max_length=50)


async def require_admin(user: dict = Depends(verify_token)):
    """Dependency to require admin privileges"""
    if user.get("discord_id") not in settings.admin_discord_ids_set:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user


@router.get("/me")
async def get_admin_me(admin: dict = Depends(require_admin)):
    """Validate the current user as an administrator."""
    return await serialize_user(admin)


@router.get("/pending-leaderboards")
async def get_pending_leaderboards(admin: dict = Depends(require_admin)):
    """Get all pending leaderboards for review"""
    leaderboards = await db.fetch_all("""
        SELECT l.*, u.username as creator_username
        FROM leaderboards l
        JOIN users u ON l.creator_id = u.id
        WHERE l.status = 'pending'
        ORDER BY l.created_at ASC
    """)
    return leaderboards


@router.get("/pending-options")
async def get_pending_options(admin: dict = Depends(require_admin)):
    """Get all pending options for review"""
    options = await db.fetch_all("""
        SELECT o.*, l.title as leaderboard_title, u.username as creator_username
        FROM options o
        JOIN leaderboards l ON o.leaderboard_id = l.id
        JOIN users u ON l.creator_id = u.id
        WHERE o.status = 'pending'
        ORDER BY o.created_at ASC
    """)
    return options


@router.get("/pending-categories")
async def get_pending_categories(admin: dict = Depends(require_admin)):
    """Get all pending categories for review"""
    categories = await db.fetch_all("""
        SELECT c.*, u.username as creator_username
        FROM categories c
        JOIN users u ON c.creator_id = u.id
        WHERE c.status = 'pending'
        ORDER BY c.created_at ASC
    """)
    return categories


@router.get("/reports")
async def get_reports(status: str = "open", admin: dict = Depends(require_admin)):
    """Get reports by status"""
    reports = await db.fetch_all("""
        SELECT r.*, u.username as reporter_username
        FROM reports r
        LEFT JOIN users u ON r.reporter_id = u.id
        WHERE r.status = ?
        ORDER BY r.created_at DESC
    """, (status,))
    return reports


@router.get("/stats")
async def get_admin_stats(admin: dict = Depends(require_admin)):
    """Get live moderation counts for the admin dashboard."""
    pending_leaderboards = await db.fetch_one("SELECT COUNT(*) as count FROM leaderboards WHERE status = 'pending'")
    pending_options = await db.fetch_one("SELECT COUNT(*) as count FROM options WHERE status = 'pending'")
    pending_categories = await db.fetch_one("SELECT COUNT(*) as count FROM categories WHERE status = 'pending'")
    pending_status_requests = await db.fetch_one("SELECT COUNT(*) as count FROM status_requests WHERE status = 'pending'")
    open_reports = await db.fetch_one("SELECT COUNT(*) as count FROM reports WHERE status = 'open'")
    total_leaderboards = await db.fetch_one("SELECT COUNT(*) as count FROM leaderboards WHERE is_active = 1")
    total_options = await db.fetch_one("SELECT COUNT(*) as count FROM options")
    total_votes = await db.fetch_one("SELECT COUNT(*) as count FROM votes")
    total_users = await db.fetch_one("SELECT COUNT(*) as count FROM users")

    return {
        "pending_leaderboards": pending_leaderboards["count"],
        "pending_options": pending_options["count"],
        "pending_categories": pending_categories["count"],
        "pending_status_requests": pending_status_requests["count"],
        "open_reports": open_reports["count"],
        "total_leaderboards": total_leaderboards["count"],
        "total_options": total_options["count"],
        "total_votes": total_votes["count"],
        "total_users": total_users["count"],
        "approved_leaderboards": total_leaderboards["count"],
    }


@router.get("/status-requests")
async def get_status_requests(status: str = "pending", admin: dict = Depends(require_admin)):
    rows = await db.fetch_all(
        """
        SELECT sr.*, u.username, u.avatar_url, u.reputation_score, u.profile_status
        FROM status_requests sr
        JOIN users u ON u.id = sr.user_id
        WHERE sr.status = ?
        ORDER BY sr.created_at ASC
        """,
        (status,),
    )
    return rows


@router.post("/status-requests/{request_id}/review")
async def review_status_request(
    request_id: int,
    action: StatusRequestReview,
    admin: dict = Depends(require_admin),
):
    normalized = action.status.lower().strip()
    if normalized not in {"approved", "rejected"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be approved or rejected"
        )

    request_row = await db.fetch_one(
        "SELECT * FROM status_requests WHERE id = ?",
        (request_id,),
    )
    if not request_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Status request not found"
        )

    if normalized == "approved":
        if action.action_type == "status":
            next_status = (action.profile_status or "").strip()
            if not next_status:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Select a profile status to apply"
                )
            await db.execute(
                "UPDATE users SET profile_status = ? WHERE id = ?",
                (next_status, request_row["user_id"]),
            )
        elif action.action_type == "badge":
            badge_id = normalize_badge_id(action.badge_id or "")
            if not badge_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Select a badge to award"
                )
            await db.execute(
                """
                INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_by)
                VALUES (?, ?, ?)
                """,
                (request_row["user_id"], badge_id, admin["id"]),
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Choose whether approval changes status or awards a badge"
            )

    await db.execute(
        """
        UPDATE status_requests
        SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolution_reason = ?
        WHERE id = ?
        """,
        (normalized, action.reason.strip(), request_id),
    )
    return {"id": request_id, "status": normalized}


@router.get("/badges")
async def get_available_badges(admin: dict = Depends(require_admin)):
    return [
        {"id": badge_id, **badge}
        for badge_id, badge in sorted(
            BADGE_DEFINITIONS.items(),
            key=lambda item: item[1].get("priority", 0),
            reverse=True,
        )
    ]


@router.get("/leaderboards")
async def get_all_leaderboards(limit: int = 500, admin: dict = Depends(require_admin)):
    rows = await db.fetch_all(
        """
        SELECT l.*,
               u.username as creator_username,
               (SELECT COUNT(*) FROM votes WHERE leaderboard_id = l.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE leaderboard_id = l.id) as total_options
        FROM leaderboards l
        JOIN users u ON u.id = l.creator_id
        ORDER BY l.created_at DESC
        LIMIT ?
        """,
        (limit,)
    )
    return rows


@router.patch("/users/{user_id}/profile")
async def update_user_profile_admin(
    user_id: int,
    payload: UserProfileAdminUpdate,
    admin: dict = Depends(require_admin),
):
    user = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if payload.profile_status is not None:
        await db.execute(
            "UPDATE users SET profile_status = ? WHERE id = ?",
            (payload.profile_status.strip() or None, user_id),
        )
    if payload.badge_id:
        await db.execute(
            """
            INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_by)
            VALUES (?, ?, ?)
            """,
            (user_id, normalize_badge_id(payload.badge_id), admin["id"]),
        )
    updated = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    return await serialize_user(updated)


@router.delete("/leaderboards/{leaderboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_remove_leaderboard(leaderboard_id: int, admin: dict = Depends(require_admin)):
    await db.execute("UPDATE leaderboards SET is_active = 0 WHERE id = ?", (leaderboard_id,))
    return None


@router.get("/users")
async def get_all_users(limit: int = 500, admin: dict = Depends(require_admin)):
    rows = await db.fetch_all(
        """
        SELECT u.*,
               (SELECT COUNT(*) FROM votes WHERE user_id = u.id) as total_votes_cast,
               (SELECT COUNT(*) FROM leaderboards WHERE creator_id = u.id AND is_active = 1) as active_leaderboards
        FROM users u
        ORDER BY u.created_at DESC
        LIMIT ?
        """,
        (limit,)
    )
    return [await serialize_user(row) for row in rows]


@router.get("/analytics/votes")
async def get_vote_analytics(days: int = 30, admin: dict = Depends(require_admin)):
    rows = await db.fetch_all(
        """
        SELECT days.day::date as date, COUNT(v.id) as count
        FROM generate_series(
            CURRENT_DATE - (($1::integer - 1) * INTERVAL '1 day'),
            CURRENT_DATE,
            INTERVAL '1 day'
        ) AS days(day)
        LEFT JOIN votes v ON DATE(v.created_at) = days.day::date
        GROUP BY days.day
        ORDER BY days.day ASC
        """,
        (days,)
    )
    return rows


@router.get("/analytics/categories")
async def get_category_analytics(admin: dict = Depends(require_admin)):
    rows = await db.fetch_all(
        """
        SELECT COALESCE(category, 'Other') as name, COUNT(*) as count
        FROM leaderboards
        WHERE is_active = 1
        GROUP BY COALESCE(category, 'Other')
        ORDER BY count DESC
        LIMIT 10
        """
    )
    return rows


@router.get("/activity")
async def get_admin_activity(limit: int = 20, admin: dict = Depends(require_admin)):
    rows = await db.fetch_all(
        """
        SELECT 'leaderboard' as type, 'created' as action, l.title as title, u.username as user, l.created_at as time
        FROM leaderboards l JOIN users u ON u.id = l.creator_id
        UNION ALL
        SELECT 'option' as type, 'created' as action, o.name as title, u.username as user, o.created_at as time
        FROM options o JOIN leaderboards l ON l.id = o.leaderboard_id JOIN users u ON u.id = l.creator_id
        UNION ALL
        SELECT 'report' as type, 'filed' as action, ('Report #' || r.id) as title, COALESCE(u.username, 'Anonymous') as user, r.created_at as time
        FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
        ORDER BY time DESC
        LIMIT ?
        """,
        (limit,)
    )
    return rows


@router.post("/leaderboards/{leaderboard_id}/review")
async def review_leaderboard(
    leaderboard_id: int,
    action: AdminAction,
    admin: dict = Depends(require_admin)
):
    """Approve or reject a leaderboard"""
    leaderboard = await db.fetch_one(
        "SELECT * FROM leaderboards WHERE id = ?",
        (leaderboard_id,)
    )
    
    if not leaderboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    await db.execute(
        """
        UPDATE leaderboards 
        SET status = ?, approved_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (action.status, leaderboard_id)
    )
    
    return {"status": action.status, "leaderboard_id": leaderboard_id}


@router.post("/options/{option_id}/review")
async def review_option(
    option_id: int,
    action: AdminAction,
    admin: dict = Depends(require_admin)
):
    """Approve or reject an option"""
    option = await db.fetch_one(
        "SELECT * FROM options WHERE id = ?",
        (option_id,)
    )
    
    if not option:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Option not found"
        )
    
    await db.execute(
        """
        UPDATE options 
        SET status = ?, approved_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (action.status, option_id)
    )
    
    return {"status": action.status, "option_id": option_id}


@router.post("/categories/{category_id}/review")
async def review_category(
    category_id: int,
    action: AdminAction,
    admin: dict = Depends(require_admin)
):
    """Approve or reject a category"""
    category = await db.fetch_one(
        "SELECT * FROM categories WHERE id = ?",
        (category_id,)
    )
    
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )
    
    await db.execute(
        """
        UPDATE categories 
        SET status = ?, approved_at = CURRENT_TIMESTAMP, approval_reason = ?
        WHERE id = ?
        """,
        (action.status, action.reason, category_id)
    )
    
    return {"status": action.status, "category_id": category_id}


@router.post("/reports/{report_id}/resolve")
async def resolve_report(
    report_id: int,
    action: AdminAction,
    admin: dict = Depends(require_admin)
):
    """Resolve a report"""
    report = await db.fetch_one(
        "SELECT * FROM reports WHERE id = ?",
        (report_id,)
    )
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    await db.execute(
        """
        UPDATE reports 
        SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolution_reason = ?
        WHERE id = ?
        """,
        (action.status, action.reason, report_id)
    )
    
    return {"status": action.status, "report_id": report_id}


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    payload: BanRequest,
    admin: dict = Depends(require_admin)
):
    """Ban a user"""
    user = await db.fetch_one(
        "SELECT * FROM users WHERE id = ?",
        (user_id,)
    )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    await db.execute(
        "UPDATE users SET is_banned = 1 WHERE id = ?",
        (user_id,)
    )
    
    return {"user_id": user_id, "banned": True}


@router.post("/users/{user_id}/unban")
async def unban_user(user_id: int, admin: dict = Depends(require_admin)):
    user = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    await db.execute("UPDATE users SET is_banned = 0 WHERE id = ?", (user_id,))
    return {"user_id": user_id, "banned": False}
