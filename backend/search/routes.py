from fastapi import APIRouter, Query
from typing import List, Optional
from backend.database import db
from backend.models import LeaderboardWithStats


router = APIRouter(prefix="/search", tags=["search"])


async def calculate_trending_score(leaderboard_id: int) -> float:
    """Calculate trending score based on recent activity"""
    recent_votes = await db.fetch_one(
        """
        SELECT COUNT(*) as count FROM votes 
        WHERE leaderboard_id = ? 
        AND created_at >= datetime('now', '-1 day')
        """,
        (leaderboard_id,)
    )
    
    total_votes = await db.fetch_one(
        "SELECT COUNT(*) as count FROM votes WHERE leaderboard_id = ?",
        (leaderboard_id,)
    )
    
    recent_count = recent_votes["count"] if recent_votes else 0
    total_count = total_votes["count"] if total_votes else 0
    
    return (recent_count * 2) + (total_count * 0.1)


@router.get("/leaderboards", response_model=List[LeaderboardWithStats])
async def search_leaderboards(
    q: str = Query(..., min_length=1, max_length=100),
    category: Optional[str] = None,
    sort_by: str = Query("trending", regex="^(trending|newest|most_votes)$"),
    limit: int = Query(20, ge=1, le=50)
):
    """Search leaderboards by title, description, category, and option text."""
    
    # Build search query
    query = """
        SELECT DISTINCT l.*, 
               u.username as creator_username,
               (SELECT COUNT(*) FROM votes WHERE leaderboard_id = l.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE leaderboard_id = l.id) as total_options
        FROM leaderboards l
        JOIN users u ON l.creator_id = u.id
        LEFT JOIN options o ON o.leaderboard_id = l.id
        WHERE l.is_active = 1
        AND (
            l.title LIKE ?
            OR l.description LIKE ?
            OR l.category LIKE ?
            OR o.name LIKE ?
            OR o.description LIKE ?
            OR o.tags LIKE ?
        )
    """
    params = [f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"]
    
    if category:
        query += " AND l.category = ?"
        params.append(category)
    
    leaderboards = await db.fetch_all(query, tuple(params))
    
    # Add trending scores
    for lb in leaderboards:
        lb["trending_score"] = await calculate_trending_score(lb["id"])
    
    # Sort results
    if sort_by == "trending":
        leaderboards.sort(key=lambda x: x["trending_score"], reverse=True)
    elif sort_by == "newest":
        leaderboards.sort(key=lambda x: x["created_at"], reverse=True)
    elif sort_by == "most_votes":
        leaderboards.sort(key=lambda x: x["total_votes"], reverse=True)
    
    return [LeaderboardWithStats(**lb) for lb in leaderboards[:limit]]


@router.get("/categories")
async def get_categories():
    """Get all available categories"""
    categories = await db.fetch_all(
        """
        SELECT DISTINCT category, COUNT(*) as count
        FROM leaderboards
        WHERE category IS NOT NULL AND is_active = 1
        GROUP BY category
        ORDER BY count DESC
        """
    )
    return categories


@router.get("/trending")
async def get_trending_search_terms(limit: int = Query(8, ge=1, le=20)):
    """Return real popular terms from live leaderboard data."""
    rows = await db.fetch_all(
        """
        SELECT l.title as term,
               COUNT(DISTINCT v.id) as votes,
               COUNT(DISTINCT o.id) as options_count,
               l.created_at
        FROM leaderboards l
        LEFT JOIN votes v ON v.leaderboard_id = l.id
        LEFT JOIN options o ON o.leaderboard_id = l.id
        WHERE l.is_active = 1
        GROUP BY l.id
        ORDER BY votes DESC, options_count DESC, l.created_at DESC
        LIMIT ?
        """,
        (limit,)
    )
    return rows
