from typing import Any, Dict, List

from backend.config import settings
from backend.database import db


BADGE_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "dev": {
        "label": "Developer",
        "short": "Dev",
        "icon": "🛠️",
        "priority": 100,
        "description": "Helps build and maintain Leaderboards.",
    },
    "verified": {
        "label": "Verified",
        "short": "Verified",
        "icon": "✅",
        "priority": 90,
        "description": "Identity or community standing has been verified.",
    },
    "creator": {
        "label": "Creator",
        "short": "Creator",
        "icon": "🎨",
        "priority": 70,
        "description": "Created at least one leaderboard.",
    },
    "tester": {
        "label": "Tester",
        "short": "Tester",
        "icon": "🧪",
        "priority": 60,
        "description": "Helped test features before release.",
    },
    "early_access": {
        "label": "Early Access",
        "short": "Early",
        "icon": "🚀",
        "priority": 50,
        "description": "Joined during the early access period.",
    },
}


def normalize_badge_id(value: str) -> str:
    return "_".join(str(value or "").strip().lower().replace("-", " ").split())


def build_badge(badge_id: str, awarded_at: Any = None) -> Dict[str, Any]:
    badge_id = normalize_badge_id(badge_id)
    base = BADGE_DEFINITIONS.get(
        badge_id,
        {
            "label": badge_id.replace("_", " ").title(),
            "short": badge_id.replace("_", " ").title(),
            "icon": "*",
            "priority": 10,
            "description": "Community badge.",
        },
    )
    return {"id": badge_id, **base, "awarded_at": awarded_at}


async def get_user_badges(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {}

    def add_badge(badge_id: str, awarded_at: Any = None):
        badge = build_badge(badge_id, awarded_at or user.get("created_at"))
        if badge["id"]:
            by_id[badge["id"]] = badge

    is_admin = str(user.get("discord_id") or "").strip() in settings.admin_discord_ids_set
    if is_admin:
        add_badge("dev")
        add_badge("early_access")

    leaderboards = await db.fetch_one(
        "SELECT COUNT(*) as count FROM leaderboards WHERE creator_id = ? AND is_active = 1",
        (user["id"],),
    )
    if leaderboards and leaderboards["count"] > 0:
        add_badge("creator")

    stored = await db.fetch_all(
        "SELECT badge_id, awarded_at FROM user_badges WHERE user_id = ?",
        (user["id"],),
    )
    for row in stored:
        add_badge(row["badge_id"], row.get("awarded_at"))

    return sorted(by_id.values(), key=lambda badge: badge.get("priority", 0), reverse=True)


async def serialize_user(user: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(user)
    badges = await get_user_badges(result)
    result["badges"] = badges
    result["status_label"] = (
        result.get("profile_status")
        or (f"{badges[0].get('short') or badges[0].get('label')} Member" if badges else "Community Member")
    )
    result["leaderboards_created"] = (
        await db.fetch_one(
            "SELECT COUNT(*) as count FROM leaderboards WHERE creator_id = ? AND is_active = 1",
            (result["id"],),
        )
    )["count"]
    return result
