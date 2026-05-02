from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DISCORD_CLIENT_ID: str
    DISCORD_CLIENT_SECRET: str
    DISCORD_REDIRECT_URI: str
    SECRET_KEY: str
    ADMIN_DISCORD_ID: str  # Discord ID of admin user
    ADMIN_DISCORD_IDS: str = ""  # Optional comma-separated admin Discord IDs
    DATABASE_URL: str = ""
    CORS_ORIGINS: str = "http://localhost:8000,http://localhost:3000"
    
    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def admin_discord_ids_set(self) -> set[str]:
        ids = {self.ADMIN_DISCORD_ID.strip()}
        ids.update(
            admin_id.strip()
            for admin_id in self.ADMIN_DISCORD_IDS.split(",")
            if admin_id.strip()
        )
        return {admin_id for admin_id in ids if admin_id}
    
    class Config:
        env_file = ".env"


settings = Settings()
