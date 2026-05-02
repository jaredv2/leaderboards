from fastapi import APIRouter, HTTPException, status, Request, Depends
from typing import List
from backend.database import db
from backend.models import Vote, VoteCreate
from backend.auth.routes import verify_token
from datetime import datetime, timezone


router = APIRouter(prefix="/votes", tags=["votes"])


def parse_db_datetime(value):
    """Return a timezone-aware datetime for values returned by the database/Pydantic."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def calculate_vote_weight(user_id: int) -> float:
    """Normalize reputation into a bounded vote weight.

    Reputation is stored on a -100 to 100 scale. A neutral reputation of 0
    keeps a normal 1x vote. Negative reputation can reduce weight to 0.5x,
    while positive reputation can grow weight to 3x.
    """
    user = await db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    
    if not user:
        return 1.0
    
    reputation = max(-100.0, min(100.0, float(user.get("reputation_score") or 0.0)))

    if reputation < 0:
        weight = 1.0 + (reputation / 100.0) * 0.5
    else:
        weight = 1.0 + (reputation / 100.0) * 2.0

    return round(max(0.5, min(3.0, weight)), 2)


async def update_user_reputation(user_id: int):
    """Update user reputation on a -100 to 100 participation scale."""
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
        return
    reputation = round(max(-100, min(100, (
        min(stats["votes_cast"], 100) * 0.2
        + min(stats["leaderboards_created"], 30) * 1.2
        + min(stats["options_on_owned"], 200) * 0.15
        + min(stats["votes_received"], 300) * 0.18
        - min(stats["open_reports"], 20) * 2.5
        - min(stats["resolved_reports"], 20) * 1.0
    ))), 2)
    await db.execute(
        "UPDATE users SET reputation_score = ? WHERE id = ?",
        (reputation, user_id)
    )


@router.post("", response_model=Vote, status_code=status.HTTP_201_CREATED)
async def cast_vote(vote: VoteCreate, user: dict = Depends(verify_token)):
    """Cast a vote on an option"""
    
    # Check if leaderboard exists and is active
    leaderboard = await db.fetch_one(
        "SELECT * FROM leaderboards WHERE id = ? AND is_active = 1",
        (vote.leaderboard_id,)
    )
    
    if not leaderboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    # Check if voting deadline has passed
    if leaderboard["voting_deadline"]:
        deadline = parse_db_datetime(leaderboard["voting_deadline"])
        if datetime.now(timezone.utc) > deadline:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Voting deadline has passed"
            )
    
    # Check if option exists
    option = await db.fetch_one(
        "SELECT * FROM options WHERE id = ? AND leaderboard_id = ?",
        (vote.option_id, vote.leaderboard_id)
    )
    
    if not option:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Option not found"
        )
    
    # Check if user has already voted on this option
    existing_vote = await db.fetch_one(
        "SELECT * FROM votes WHERE user_id = ? AND option_id = ?",
        (user["id"], vote.option_id)
    )
    
    if existing_vote:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already voted on this option"
        )
    
    # Check max votes per user for this leaderboard
    user_votes = await db.fetch_one(
        """
        SELECT COUNT(*) as count FROM votes 
        WHERE user_id = ? AND leaderboard_id = ?
        """,
        (user["id"], vote.leaderboard_id)
    )
    
    if user_votes["count"] >= leaderboard["max_votes_per_user"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum votes per user ({leaderboard['max_votes_per_user']}) reached"
        )
    
    # Calculate vote weight based on reputation
    weight = await calculate_vote_weight(user["id"])
    
    # Cast vote
    cursor = await db.execute(
        """
        INSERT INTO votes (user_id, option_id, leaderboard_id, weight)
        VALUES (?, ?, ?, ?)
        """,
        (user["id"], vote.option_id, vote.leaderboard_id, weight)
    )
    
    vote_id = cursor.lastrowid
    
    # Update user's total votes
    await db.execute(
        "UPDATE users SET total_votes = total_votes + 1 WHERE id = ?",
        (user["id"],)
    )
    
    # Update user reputation
    await update_user_reputation(user["id"])
    
    result = await db.fetch_one("SELECT * FROM votes WHERE id = ?", (vote_id,))
    return Vote(**result)


@router.get("/leaderboard/{leaderboard_id}")
async def get_leaderboard_votes(leaderboard_id: int):
    """Get all votes for a leaderboard"""
    votes = await db.fetch_all(
        """
        SELECT v.*, u.username, o.name as option_name
        FROM votes v
        JOIN users u ON v.user_id = u.id
        JOIN options o ON v.option_id = o.id
        WHERE v.leaderboard_id = ?
        ORDER BY v.created_at DESC
        """,
        (leaderboard_id,)
    )
    return votes


@router.get("/user/{user_id}")
async def get_user_votes(user_id: int):
    """Get all votes by a user"""
    votes = await db.fetch_all(
        """
        SELECT v.*, l.title as leaderboard_title, o.name as option_name
        FROM votes v
        JOIN leaderboards l ON v.leaderboard_id = l.id
        JOIN options o ON v.option_id = o.id
        WHERE v.user_id = ?
        ORDER BY v.created_at DESC
        """,
        (user_id,)
    )
    return votes


@router.delete("/{vote_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vote(vote_id: int, user: dict = Depends(verify_token)):
    """Delete a vote (vote owner only)"""
    # Check ownership
    vote = await db.fetch_one(
        "SELECT * FROM votes WHERE id = ?",
        (vote_id,)
    )
    
    if not vote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vote not found"
        )
    
    if vote["user_id"] != user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this vote"
        )
    
    await db.execute("DELETE FROM votes WHERE id = ?", (vote_id,))
    
    # Update user's total votes
    await db.execute(
        "UPDATE users SET total_votes = total_votes - 1 WHERE id = ?",
        (user["id"],)
    )
    
    return None


@router.delete("/option/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vote_for_option(option_id: int, user: dict = Depends(verify_token)):
    """Delete the current user's vote for an option."""
    vote = await db.fetch_one(
        "SELECT * FROM votes WHERE user_id = ? AND option_id = ?",
        (user["id"], option_id)
    )

    if not vote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No vote found for this option"
        )

    await db.execute("DELETE FROM votes WHERE id = ?", (vote["id"],))
    await db.execute(
        "UPDATE users SET total_votes = MAX(total_votes - 1, 0) WHERE id = ?",
        (user["id"],)
    )

    return None
