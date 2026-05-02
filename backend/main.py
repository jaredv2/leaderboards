from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings
from backend.database import db
from backend.middleware.rate_limit import rate_limit_middleware
from backend.middleware.csrf import csrf_middleware
from backend.auth.routes import router as auth_router
from backend.leaderboards.routes import router as leaderboards_router
from backend.options.routes import router as options_router
from backend.votes.routes import router as votes_router
from backend.users.routes import router as users_router
from backend.search.routes import router as search_router
from backend.categories.routes import router as categories_router
from backend.admin.routes import router as admin_router


app = FastAPI(title="Leaderboard Voting API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting middleware
app.middleware("http")(rate_limit_middleware)

# CSRF protection middleware
app.middleware("http")(csrf_middleware)

# Include routers with /api prefix
app.include_router(auth_router, prefix="/api")
app.include_router(leaderboards_router, prefix="/api")
app.include_router(options_router, prefix="/api")
app.include_router(votes_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(admin_router, prefix="/api")


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return FileResponse("frontend/index.html")
            raise


# Serve static files and fall back to the SPA for client-side routes.
app.mount("/", SPAStaticFiles(directory="frontend", html=True), name="frontend")


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    await db.initialize()


@app.on_event("shutdown")
async def shutdown_event():
    """Close database connections on shutdown"""
    await db.close()


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
