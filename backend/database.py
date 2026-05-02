import re
from typing import Optional, List, Dict, Any

import asyncpg

from backend.config import settings


class QueryResult:
    def __init__(self, lastrowid: Optional[int] = None):
        self.lastrowid = lastrowid


class Database:
    def __init__(self):
        self.database_url = settings.DATABASE_URL
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        if not self.database_url.startswith(("postgresql://", "postgres://")):
            raise RuntimeError(
                "DATABASE_URL must be a Postgres connection string, for example "
                "postgresql://user:password@host/db?sslmode=require"
            )
        if self.pool is None:
            self.pool = await asyncpg.create_pool(
                self.database_url,
                min_size=1,
                max_size=5,
                command_timeout=30,
            )

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def _get_pool(self) -> asyncpg.Pool:
        await self.connect()
        return self.pool

    def _normalize_query(self, query: str) -> str:
        normalized = query.strip()
        normalized = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", normalized, flags=re.IGNORECASE)
        normalized = normalized.replace("datetime('now', '-1 day')", "CURRENT_TIMESTAMP - INTERVAL '1 day'")
        normalized = normalized.replace("date('now')", "CURRENT_DATE")
        normalized = normalized.replace("date(created_at)", "DATE(created_at)")
        normalized = normalized.replace("date(v.created_at)", "DATE(v.created_at)")
        normalized = normalized.replace("is_active = 1", "is_active = TRUE")
        normalized = normalized.replace("is_active = 0", "is_active = FALSE")
        normalized = normalized.replace("is_banned = 1", "is_banned = TRUE")
        normalized = normalized.replace("is_banned = 0", "is_banned = FALSE")
        normalized = normalized.replace("MAX(total_votes - 1, 0)", "GREATEST(total_votes - 1, 0)")

        if re.search(r"^\s*INSERT\s+INTO\s+user_badges\b", normalized, flags=re.IGNORECASE):
            normalized = self._strip_semicolon(normalized)
            if "ON CONFLICT" not in normalized.upper():
                normalized += " ON CONFLICT (user_id, badge_id) DO NOTHING"

        return self._convert_placeholders(normalized)

    def _strip_semicolon(self, query: str) -> str:
        return query.rstrip().rstrip(";")

    def _convert_placeholders(self, query: str) -> str:
        parts = query.split("?")
        if len(parts) == 1:
            return query
        converted = [parts[0]]
        for index, part in enumerate(parts[1:], start=1):
            converted.append(f"${index}")
            converted.append(part)
        return "".join(converted)

    def _insert_with_returning(self, query: str) -> str:
        if not re.match(r"^\s*INSERT\s+INTO\b", query, flags=re.IGNORECASE):
            return query
        if re.search(r"\bRETURNING\b", query, flags=re.IGNORECASE):
            return query
        return f"{self._strip_semicolon(query)} RETURNING id"

    async def initialize(self):
        """Create all tables and indexes if they don't exist."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    discord_id TEXT UNIQUE NOT NULL,
                    username TEXT NOT NULL,
                    avatar_url TEXT,
                    bio TEXT DEFAULT '',
                    show_activity BOOLEAN DEFAULT TRUE,
                    profile_status TEXT,
                    csrf_token TEXT,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    reputation_score DOUBLE PRECISION DEFAULT 1.0,
                    total_votes INTEGER DEFAULT 0,
                    leaderboards_created INTEGER DEFAULT 0,
                    is_banned BOOLEAN DEFAULT FALSE,
                    last_active TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS categories (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL,
                    creator_id INTEGER NOT NULL REFERENCES users(id),
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    approved_at TIMESTAMPTZ,
                    approval_reason TEXT
                );

                CREATE TABLE IF NOT EXISTS leaderboards (
                    id SERIAL PRIMARY KEY,
                    creator_id INTEGER NOT NULL REFERENCES users(id),
                    title TEXT NOT NULL,
                    description TEXT,
                    image_url TEXT,
                    category TEXT,
                    max_options INTEGER DEFAULT 10,
                    max_votes_per_user INTEGER DEFAULT 1,
                    allow_user_options BOOLEAN DEFAULT FALSE,
                    voting_deadline TIMESTAMPTZ,
                    sorting_method TEXT DEFAULT 'weighted',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE,
                    status TEXT DEFAULT 'pending',
                    approved_at TIMESTAMPTZ
                );

                CREATE TABLE IF NOT EXISTS options (
                    id SERIAL PRIMARY KEY,
                    leaderboard_id INTEGER NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    description TEXT,
                    image_url TEXT,
                    external_url TEXT,
                    tags TEXT,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'pending',
                    approved_at TIMESTAMPTZ
                );

                CREATE TABLE IF NOT EXISTS votes (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    option_id INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
                    leaderboard_id INTEGER NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
                    weight DOUBLE PRECISION DEFAULT 1.0,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, option_id)
                );

                CREATE TABLE IF NOT EXISTS reports (
                    id SERIAL PRIMARY KEY,
                    reporter_id INTEGER REFERENCES users(id),
                    content_type TEXT NOT NULL,
                    content_id INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    description TEXT,
                    status TEXT DEFAULT 'open',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMPTZ,
                    resolution_reason TEXT
                );

                CREATE TABLE IF NOT EXISTS status_requests (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    request TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMPTZ,
                    resolution_reason TEXT
                );

                CREATE TABLE IF NOT EXISTS user_badges (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    badge_id TEXT NOT NULL,
                    awarded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    awarded_by INTEGER REFERENCES users(id),
                    UNIQUE(user_id, badge_id)
                );

                CREATE TABLE IF NOT EXISTS rate_limits (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    ip_address TEXT,
                    action TEXT NOT NULL,
                    count INTEGER DEFAULT 1,
                    window_start TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_leaderboards_created ON leaderboards(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_leaderboards_category ON leaderboards(category);
                CREATE INDEX IF NOT EXISTS idx_leaderboards_status ON leaderboards(status);
                CREATE INDEX IF NOT EXISTS idx_votes_option ON votes(option_id);
                CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
                CREATE INDEX IF NOT EXISTS idx_options_leaderboard ON options(leaderboard_id);
                CREATE INDEX IF NOT EXISTS idx_options_status ON options(status);
                CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
                CREATE INDEX IF NOT EXISTS idx_status_requests_status ON status_requests(status);
                CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
                CREATE INDEX IF NOT EXISTS idx_rate_limits_action ON rate_limits(action, window_start);
                """
            )
            await conn.execute(
                """
                UPDATE leaderboards
                SET status = 'approved',
                    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
                WHERE status = 'pending'
                """
            )
            await conn.execute(
                """
                UPDATE options
                SET status = 'approved',
                    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
                WHERE status = 'pending'
                """
            )

    async def execute(self, query: str, params: tuple = ()) -> QueryResult:
        pool = await self._get_pool()
        normalized = self._normalize_query(query)
        async with pool.acquire() as conn:
            returning_query = self._insert_with_returning(normalized)
            if returning_query != normalized:
                row = await conn.fetchrow(returning_query, *params)
                return QueryResult(row["id"] if row else None)
            await conn.execute(normalized, *params)
            return QueryResult()

    async def fetch_one(self, query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        pool = await self._get_pool()
        normalized = self._normalize_query(query)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(normalized, *params)
            return dict(row) if row else None

    async def fetch_all(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        pool = await self._get_pool()
        normalized = self._normalize_query(query)
        async with pool.acquire() as conn:
            rows = await conn.fetch(normalized, *params)
            return [dict(row) for row in rows]


db = Database()
