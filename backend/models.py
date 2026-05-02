from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class UserBase(BaseModel):
    discord_id: str
    username: str
    avatar_url: Optional[str] = None


class UserCreate(UserBase):
    pass


class User(UserBase):
    id: int
    created_at: datetime
    reputation_score: float
    total_votes: int
    leaderboards_created: int
    is_banned: bool
    last_active: datetime
    bio: Optional[str] = ""
    show_activity: bool = True
    profile_status: Optional[str] = None
    status_label: Optional[str] = None
    badges: List[Dict[str, Any]] = Field(default_factory=list)
    csrf_token: Optional[str] = None
    
    class Config:
        from_attributes = True


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class CategoryCreate(CategoryBase):
    pass


class Category(CategoryBase):
    id: int
    creator_id: int
    status: str  # pending, approved, rejected
    created_at: datetime
    approved_at: Optional[datetime] = None
    approval_reason: Optional[str] = None
    
    class Config:
        from_attributes = True


class LeaderboardBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    image_url: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    max_options: int = Field(default=10, ge=1, le=1000000)
    max_votes_per_user: int = Field(default=1, ge=1, le=1000000)
    allow_user_options: bool = False
    voting_deadline: Optional[datetime] = None
    sorting_method: str = Field(default="weighted", pattern="^(weighted|most_votes|newest|trending)$")


class LeaderboardCreate(LeaderboardBase):
    pass


class LeaderboardUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    image_url: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    voting_deadline: Optional[datetime] = None
    is_active: Optional[bool] = None


class Leaderboard(LeaderboardBase):
    id: int
    creator_id: int
    created_at: datetime
    updated_at: datetime
    is_active: bool
    status: str  # pending, approved, rejected
    approved_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class LeaderboardWithStats(Leaderboard):
    creator_username: str
    total_votes: int
    total_options: int
    trending_score: float


class OptionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    image_url: Optional[str] = None
    external_url: Optional[str] = None
    tags: Optional[str] = Field(None, max_length=200)


class OptionCreate(OptionBase):
    leaderboard_id: int


class OptionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    image_url: Optional[str] = None
    external_url: Optional[str] = None
    tags: Optional[str] = Field(None, max_length=200)


class Option(OptionBase):
    id: int
    leaderboard_id: int
    created_at: datetime
    status: str  # pending, approved, rejected
    approved_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class OptionWithVotes(Option):
    vote_count: int
    weighted_score: float
    user_voted: bool = False
    user_vote_id: Optional[int] = None


class VoteBase(BaseModel):
    option_id: int
    leaderboard_id: int


class VoteCreate(VoteBase):
    pass


class Vote(VoteBase):
    id: int
    user_id: int
    weight: float
    created_at: datetime
    
    class Config:
        from_attributes = True


class ReportBase(BaseModel):
    content_type: str = Field(..., pattern="^(leaderboard|option|user)$")
    content_id: int
    reason: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class ReportCreate(ReportBase):
    pass


class Report(ReportBase):
    id: int
    reporter_id: Optional[int] = None
    status: str  # open, investigating, resolved
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolution_reason: Optional[str] = None
    
    class Config:
        from_attributes = True


class AdminAction(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected|investigating|resolved)$")
    reason: Optional[str] = Field(None, max_length=500)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User


class TokenData(BaseModel):
    discord_id: Optional[str] = None


class SearchQuery(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)
    category: Optional[str] = None
    sort_by: str = Field(default="trending", pattern="^(trending|newest|most_votes)$")
