from fastapi import APIRouter

# Router is defined here for legacy imports/tests. The actual futures feature
# endpoints may be mounted from other modules, but this keeps the public module
# contract stable for CI smoke tests.
router = APIRouter(prefix="/futures", tags=["futures"])
