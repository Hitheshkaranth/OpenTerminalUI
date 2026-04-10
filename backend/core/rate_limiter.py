from __future__ import annotations

import time
from collections import defaultdict
from fastapi import Request, HTTPException

# Simple in-memory rate limiter
# {key_prefix: [timestamps]}
_rate_limit_store: dict[str, list[float]] = defaultdict(list)

def rate_limiter(request: Request, key_prefix: str, limit: int = 100, window: int = 60):
    """
    limit: max requests
    window: time window in seconds
    """
    now = time.time()
    timestamps = _rate_limit_store[key_prefix]
    
    # Remove timestamps outside the window
    _rate_limit_store[key_prefix] = [t for t in timestamps if now - t < window]
    
    if len(_rate_limit_store[key_prefix]) >= limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Max 100 requests per minute.")
    
    _rate_limit_store[key_prefix].append(now)

async def api_key_rate_limiter(request: Request):
    """FastAPI dependency for rate limiting by API key prefix."""
    # We assume get_api_key_user was already called if we want to use the prefix, 
    # but here we might just extract it from the header again for simplicity or 
    # use the request state if it was stored there.
    key = request.headers.get("X-API-Key")
    if not key:
        return # Missing header handled by get_api_key_user
    
    prefix = key[:12]
    rate_limiter(request, prefix)
