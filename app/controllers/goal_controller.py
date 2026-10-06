from fastapi import APIRouter

from app.core.database import get_db
from app.repositories.goal_repository import GoalRepository
from app.schemas.goal import GoalCreate, GoalOut, GoalUpdate
from app.services.goal_service import GoalService

router = APIRouter(prefix="/goals", tags=["goals"])


def _service(conn) -> GoalService:
    return GoalService(GoalRepository(conn))


@router.get("", response_model=list[GoalOut])
def list_goals():
    conn = get_db()
    try:
        return _service(conn).list_goals()
    finally:
        conn.close()


@router.get("/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: int):
    conn = get_db()
    try:
        return _service(conn).get_goal(goal_id)
    finally:
        conn.close()


@router.post("", status_code=201, response_model=GoalOut)
def create_goal(goal: GoalCreate):
    conn = get_db()
    try:
        return _service(conn).create_goal(goal)
    finally:
        conn.close()


@router.put("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, goal: GoalUpdate):
    conn = get_db()
    try:
        return _service(conn).update_goal(goal_id, goal)
    finally:
        conn.close()


@router.delete("/{goal_id}")
def delete_goal(goal_id: int):
    conn = get_db()
    try:
        _service(conn).delete_goal(goal_id)
        return {"deleted": goal_id}
    finally:
        conn.close()
