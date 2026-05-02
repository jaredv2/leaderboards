from fastapi import APIRouter, HTTPException, status, Depends
from typing import List
from backend.database import db
from backend.auth.routes import verify_token
from backend.models import Category, CategoryCreate


router = APIRouter(prefix="/categories", tags=["categories"])


@router.post("", response_model=Category, status_code=status.HTTP_201_CREATED)
async def create_category(category: CategoryCreate, user: dict = Depends(verify_token)):
    """Submit a new category for admin review"""
    # Check if category already exists
    existing = await db.fetch_one(
        "SELECT * FROM categories WHERE name = ?",
        (category.name,)
    )
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category already exists or is pending review"
        )
    
    cursor = await db.execute(
        """
        INSERT INTO categories (name, creator_id, status)
        VALUES (?, ?, 'pending')
        """,
        (category.name, user["id"])
    )
    
    category_id = cursor.lastrowid
    result = await db.fetch_one("SELECT * FROM categories WHERE id = ?", (category_id,))
    return Category(**result)


@router.get("", response_model=List[Category])
async def get_approved_categories():
    """Get all approved categories"""
    categories = await db.fetch_all("""
        SELECT * FROM categories 
        WHERE status = 'approved'
        ORDER BY name ASC
    """)
    return [Category(**cat) for cat in categories]


@router.get("/{category_id}", response_model=Category)
async def get_category(category_id: int):
    """Get a specific category"""
    category = await db.fetch_one(
        "SELECT * FROM categories WHERE id = ?",
        (category_id,)
    )
    
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )
    
    return Category(**category)
