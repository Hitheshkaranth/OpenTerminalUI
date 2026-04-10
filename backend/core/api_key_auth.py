import secrets
import hashlib
from datetime import datetime
from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.shared.db import SessionLocal
from backend.models.api_key import APIKeyORM
from sqlalchemy import func

def generate_api_key() -> tuple[str, str, str]:
    """Generate API key. Returns (full_key, prefix, hash)."""
    raw = secrets.token_urlsafe(32)
    full_key = f"otui_{raw}"
    prefix = full_key[:12]
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, prefix, key_hash

def verify_api_key(provided_key: str, stored_hash: str) -> bool:
    return hashlib.sha256(provided_key.encode()).hexdigest() == stored_hash

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_api_key_user(request: Request, db: Session = Depends(get_db)):
    """FastAPI dependency: extract and validate X-API-Key header."""
    key = request.headers.get("X-API-Key")
    if not key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    
    # Look up by prefix
    prefix = key[:12]
    api_key = db.query(APIKeyORM).filter(APIKeyORM.key_prefix == prefix, APIKeyORM.is_active == 1).first()
    
    if not api_key or not verify_api_key(key, api_key.key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    # Update last_used_at
    api_key.last_used_at = func.now()
    db.commit()
    return api_key
