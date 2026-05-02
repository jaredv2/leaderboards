from fastapi import APIRouter, HTTPException, status, Request, Depends
from typing import List
from backend.database import db
from backend.models import Option, OptionCreate, OptionUpdate, OptionWithVotes, Report, ReportCreate
from backend.auth.routes import verify_token
from jose import JWTError, jwt
from backend.config import settings
from datetime import datetime, timezone


router = APIRouter(prefix="/options", tags=["options"])


def parse_db_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def get_optional_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        discord_id = payload.get("sub")
        if not discord_id:
            return None
        return await db.fetch_one("SELECT * FROM users WHERE discord_id = ?", (discord_id,))
    except JWTError:
        return None


@router.post("", response_model=Option, status_code=status.HTTP_201_CREATED)
async def create_option(option: OptionCreate, user: dict = Depends(verify_token)):
    """Add an option to a leaderboard"""
    
    # Check if leaderboard exists and user is creator
    leaderboard = await db.fetch_one(
        "SELECT * FROM leaderboards WHERE id = ? AND is_active = 1",
        (option.leaderboard_id,)
    )
    
    if not leaderboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leaderboard not found"
        )
    
    if leaderboard["creator_id"] != user["id"] and not leaderboard.get("allow_user_options"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the creator can add options"
        )

    if leaderboard["voting_deadline"]:
        deadline = parse_db_datetime(leaderboard["voting_deadline"])
        if datetime.now(timezone.utc) > deadline:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Leaderboard is closed"
            )
    
    # Check max options limit
    option_count = await db.fetch_one(
        "SELECT COUNT(*) as count FROM options WHERE leaderboard_id = ?",
        (option.leaderboard_id,)
    )
    
    if option_count["count"] >= leaderboard["max_options"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum options limit reached"
        )
    
    # Create option
    cursor = await db.execute(
        """
        INSERT INTO options (leaderboard_id, name, description, image_url, external_url, tags, status, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
        """,
        (option.leaderboard_id, option.name, option.description, 
         option.image_url, option.external_url, option.tags)
    )
    
    option_id = cursor.lastrowid
    result = await db.fetch_one("SELECT * FROM options WHERE id = ?", (option_id,))
    return Option(**result)


@router.get("/leaderboard/{leaderboard_id}", response_model=List[OptionWithVotes])
async def get_leaderboard_options(leaderboard_id: int, request: Request):
    """Get all options for a leaderboard with vote counts"""
    user = await get_optional_user(request)
    user_id = user["id"] if user else 0
    query = """
        SELECT o.*, 
               (SELECT COUNT(*) FROM votes WHERE option_id = o.id) as vote_count,
               (SELECT COALESCE(SUM(weight), 0) FROM votes WHERE option_id = o.id) as weighted_score,
               EXISTS(SELECT 1 FROM votes WHERE option_id = o.id AND user_id = ?) as user_voted,
               (SELECT id FROM votes WHERE option_id = o.id AND user_id = ? LIMIT 1) as user_vote_id
        FROM options o
        WHERE o.leaderboard_id = ?
        ORDER BY o.created_at ASC
    """
    
    options = await db.fetch_all(query, (user_id, user_id, leaderboard_id))
    return [OptionWithVotes(**opt) for opt in options]


@router.get("/{option_id}", response_model=OptionWithVotes)
async def get_option(option_id: int, request: Request):
    """Get a specific option with vote count"""
    user = await get_optional_user(request)
    user_id = user["id"] if user else 0
    query = """
        SELECT o.*, 
               (SELECT COUNT(*) FROM votes WHERE option_id = o.id) as vote_count,
               (SELECT COALESCE(SUM(weight), 0) FROM votes WHERE option_id = o.id) as weighted_score,
               EXISTS(SELECT 1 FROM votes WHERE option_id = o.id AND user_id = ?) as user_voted,
               (SELECT id FROM votes WHERE option_id = o.id AND user_id = ? LIMIT 1) as user_vote_id
        FROM options o
        WHERE o.id = ?
    """
    
    option = await db.fetch_one(query, (user_id, user_id, option_id))
    
    if not option:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Option not found"
        )
    
    return OptionWithVotes(**option)


@router.put("/{option_id}", response_model=Option)
async def update_option(option_id: int, option: OptionUpdate, request: Request):
    """Update an option (leaderboard creator only)"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    # Get option and check ownership
    option_data = await db.fetch_one(
        "SELECT o.*, l.creator_id FROM options o JOIN leaderboards l ON o.leaderboard_id = l.id WHERE o.id = ?",
        (option_id,)
    )
    
    if not option_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Option not found"
        )
    
    if option_data["creator_id"] != user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this option"
        )
    
    # Build update query
    updates = []
    params = []
    
    if option.name is not None:
        updates.append("name = ?")
        params.append(option.name)
    if option.description is not None:
        updates.append("description = ?")
        params.append(option.description)
    if option.image_url is not None:
        updates.append("image_url = ?")
        params.append(option.image_url)
    if option.external_url is not None:
        updates.append("external_url = ?")
        params.append(option.external_url)
    if option.tags is not None:
        updates.append("tags = ?")
        params.append(option.tags)
    
    if updates:
        params.append(option_id)
        await db.execute(
            f"UPDATE options SET {', '.join(updates)} WHERE id = ?",
            tuple(params)
        )
    
    result = await db.fetch_one("SELECT * FROM options WHERE id = ?", (option_id,))
    return Option(**result)


@router.delete("/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_option(option_id: int, request: Request):
    """Delete an option (leaderboard creator only)"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    # Get option and check ownership
    option_data = await db.fetch_one(
        "SELECT o.*, l.creator_id FROM options o JOIN leaderboards l ON o.leaderboard_id = l.id WHERE o.id = ?",
        (option_id,)
    )
    
    if not option_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Option not found"
        )
    
    if option_data["creator_id"] != user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this option"
        )
    
    await db.execute("DELETE FROM options WHERE id = ?", (option_id,))
    return None


@router.post("/{option_id}/report", response_model=Report, status_code=status.HTTP_201_CREATED)
async def report_option(
    option_id: int,
    report: ReportCreate,
    user: dict = Depends(verify_token)
):
    """Report an option for violating guidelines"""
    option = await db.fetch_one(
        "SELECT * FROM options WHERE id = ?",
        (option_id,)
    )
    
    if not option:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Option not found"
        )
    
    cursor = await db.execute(
        """
        INSERT INTO reports (reporter_id, content_type, content_id, reason, description)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user["id"], "option", option_id, report.reason, report.description)
    )
    
    report_id = cursor.lastrowid
    result = await db.fetch_one("SELECT * FROM reports WHERE id = ?", (report_id,))
    return Report(**result)
