from fastapi import APIRouter, HTTPException, status, Request, Depends
from typing import List
from backend.database import db
from backend.models import Leaderboard, LeaderboardCreate, LeaderboardUpdate, LeaderboardWithStats, Report, ReportCreate
from backend.auth.routes import verify_token


router = APIRouter(prefix="/leaderboards", tags=["leaderboards"])


async def calculate_trending_score(leaderboard_id: int) -> float:
    """Calculate trending score based on recent activity"""
    # Get votes in last 24 hours
    recent_votes = await db.fetch_one(
        """
        SELECT COUNT(*) as count FROM votes 
        WHERE leaderboard_id = ? 
        AND created_at >= datetime('now', '-1 day')
        """,
        (leaderboard_id,)
    )
    
    # Get total votes
    total_votes = await db.fetch_one(
        "SELECT COUNT(*) as count FROM votes WHERE leaderboard_id = ?",
        (leaderboard_id,)
    )
    
    recent_count = recent_votes["count"] if recent_votes else 0
    total_count = total_votes["count"] if total_votes else 0
    
    # Simple trending algorithm: recent activity weighted more
    return (recent_count * 2) + (total_count * 0.1)


@router.post("", response_model=Leaderboard, status_code=status.HTTP_201_CREATED)
async def create_leaderboard(leaderboard: LeaderboardCreate, user: dict = Depends(verify_token)):
    """Create a new leaderboard"""
    # Check daily limit
    today_leaderboards = await db.fetch_one(
        """
        SELECT COUNT(*) as count FROM leaderboards 
        WHERE creator_id = ? 
        AND date(created_at) = date('now')
        """,
        (user["id"],)
    )
    
    if today_leaderboards["count"] >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily leaderboard creation limit reached"
        )
    
    # Create leaderboard
    cursor = await db.execute(
        """
        INSERT INTO leaderboards (creator_id, title, description, image_url, category, max_options, 
                                 max_votes_per_user, allow_user_options, voting_deadline, sorting_method, status, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
        """,
        (user["id"], leaderboard.title, leaderboard.description, leaderboard.image_url, leaderboard.category,
         leaderboard.max_options, leaderboard.max_votes_per_user, leaderboard.allow_user_options,
         leaderboard.voting_deadline, leaderboard.sorting_method)
    )
    
    leaderboard_id = cursor.lastrowid
    
    # Update user's leaderboard count
    await db.execute(
        "UPDATE users SET leaderboards_created = leaderboards_created + 1 WHERE id = ?",
        (user["id"],)
    )
    
    result = await db.fetch_one("SELECT * FROM leaderboards WHERE id = ?", (leaderboard_id,))
    return Leaderboard(**result)


@router.get("", response_model=List[LeaderboardWithStats])
async def get_leaderboards(limit: int = 20, offset: int = 0, category: str = None):
    """Get all active leaderboards with stats"""
    query = """
        SELECT l.*, 
               u.username as creator_username,
               (SELECT COUNT(*) FROM votes WHERE leaderboard_id = l.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE leaderboard_id = l.id) as total_options
        FROM leaderboards l
        JOIN users u ON l.creator_id = u.id
        WHERE l.is_active = 1
    """
    params = []
    
    if category:
        query += " AND l.category = ?"
        params.append(category)
    
    query += " ORDER BY l.created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    leaderboards = await db.fetch_all(query, tuple(params))
    
    # Add trending scores
    for lb in leaderboards:
        lb["trending_score"] = await calculate_trending_score(lb["id"])
    
    return [LeaderboardWithStats(**lb) for lb in leaderboards]


@router.get("/trending", response_model=List[LeaderboardWithStats])
async def get_trending_leaderboards(limit: int = 20):
    """Get trending leaderboards"""
    query = """
        SELECT l.*, 
               u.username as creator_username,
               (SELECT COUNT(*) FROM votes WHERE leaderboard_id = l.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE leaderboard_id = l.id) as total_options
        FROM leaderboards l
        JOIN users u ON l.creator_id = u.id
        WHERE l.is_active = 1
        ORDER BY l.created_at DESC
    """
    
    leaderboards = await db.fetch_all(query)
    
    # Calculate trending scores and sort
    for lb in leaderboards:
        lb["trending_score"] = await calculate_trending_score(lb["id"])
    
    leaderboards.sort(key=lambda x: x["trending_score"], reverse=True)
    
    return [LeaderboardWithStats(**lb) for lb in leaderboards[:limit]]


@router.get("/{leaderboard_id}", response_model=LeaderboardWithStats)
async def get_leaderboard(leaderboard_id: int):
    """Get a specific leaderboard with stats"""
    query = """
        SELECT l.*, 
               u.username as creator_username,
               (SELECT COUNT(*) FROM votes WHERE leaderboard_id = l.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE leaderboard_id = l.id) as total_options
        FROM leaderboards l
        JOIN users u ON l.creator_id = u.id
        WHERE l.id = ? AND l.is_active = 1
    """
    
    leaderboard = await db.fetch_one(query, (leaderboard_id,))
    
    if not leaderboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    leaderboard["trending_score"] = await calculate_trending_score(leaderboard_id)
    return LeaderboardWithStats(**leaderboard)


@router.put("/{leaderboard_id}", response_model=Leaderboard)
async def update_leaderboard(leaderboard_id: int, leaderboard: LeaderboardUpdate, request: Request):
    """Update a leaderboard (creator only)"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    # Check ownership
    existing = await db.fetch_one(
        "SELECT * FROM leaderboards WHERE id = ?",
        (leaderboard_id,)
    )
    
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    if existing["creator_id"] != user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this leaderboard"
        )
    
    # Build update query
    updates = []
    params = []
    
    if leaderboard.title is not None:
        updates.append("title = ?")
        params.append(leaderboard.title)
    if leaderboard.description is not None:
        updates.append("description = ?")
        params.append(leaderboard.description)
    if leaderboard.image_url is not None:
        updates.append("image_url = ?")
        params.append(leaderboard.image_url)
    if leaderboard.category is not None:
        updates.append("category = ?")
        params.append(leaderboard.category)
    if leaderboard.voting_deadline is not None:
        updates.append("voting_deadline = ?")
        params.append(leaderboard.voting_deadline)
    if leaderboard.is_active is not None:
        updates.append("is_active = ?")
        params.append(leaderboard.is_active)
    
    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(leaderboard_id)
        
        await db.execute(
            f"UPDATE leaderboards SET {', '.join(updates)} WHERE id = ?",
            tuple(params)
        )
    
    result = await db.fetch_one("SELECT * FROM leaderboards WHERE id = ?", (leaderboard_id,))
    return Leaderboard(**result)


@router.delete("/{leaderboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_leaderboard(leaderboard_id: int, request: Request):
    """Delete a leaderboard (creator only)"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    # Check ownership
    existing = await db.fetch_one(
        "SELECT * FROM leaderboards WHERE id = ?",
        (leaderboard_id,)
    )
    
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    if existing["creator_id"] != user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this leaderboard"
        )
    
    # Soft delete
    await db.execute(
        "UPDATE leaderboards SET is_active = 0 WHERE id = ?",
        (leaderboard_id,)
    )
    
    return None


@router.post("/{leaderboard_id}/report", response_model=Report, status_code=status.HTTP_201_CREATED)
async def report_leaderboard(
    leaderboard_id: int,
    report: ReportCreate,
    user: dict = Depends(verify_token)
):
    """Report a leaderboard for violating guidelines"""
    leaderboard = await db.fetch_one(
        "SELECT * FROM leaderboards WHERE id = ?",
        (leaderboard_id,)
    )
    
    if not leaderboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    cursor = await db.execute(
        """
        INSERT INTO reports (reporter_id, content_type, content_id, reason, description)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user["id"], "leaderboard", leaderboard_id, report.reason, report.description)
    )
    
    report_id = cursor.lastrowid
    result = await db.fetch_one("SELECT * FROM reports WHERE id = ?", (report_id,))
    return Report(**result)


@router.get("/categories", response_model=List[str])
async def get_categories():
    """Get all approved categories"""
    categories = await db.fetch_all("""
        SELECT name as category FROM categories
        WHERE status = 'approved'
        ORDER BY category ASC
    """)
    return [cat["category"] for cat in categories]
