from calendar import monthrange
from datetime import date

from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.goal_repository import GoalRepository
from app.schemas.goal import GoalCreate, GoalOut, GoalUpdate


class GoalNotFoundError(NotFoundError):
    def __init__(self, goal_id: int):
        super().__init__(
            f"Goal with id {goal_id} not found",
            {"goal_id": goal_id},
        )


class GoalService:
    """Business logic for savings and financial goals."""

    def __init__(self, repository: GoalRepository):
        self.repository = repository

    def list_goals(self) -> list[GoalOut]:
        return [self._enrich(goal) for goal in self.repository.list()]

    def get_goal(self, goal_id: int) -> GoalOut:
        goal = self.repository.get(goal_id)
        if goal is None:
            raise GoalNotFoundError(goal_id)
        return self._enrich(goal)

    def create_goal(self, goal: GoalCreate) -> GoalOut:
        if goal.current_amount > goal.target_amount:
            raise ValidationError("current_amount cannot exceed target_amount")
        return self._enrich(self.repository.create(goal))

    def update_goal(self, goal_id: int, goal: GoalUpdate) -> GoalOut:
        existing = self.get_goal(goal_id)
        payload = goal.model_dump(exclude_unset=True)
        target = float(payload.get("target_amount", existing.target_amount))
        current = float(payload.get("current_amount", existing.current_amount))
        if current > target:
            raise ValidationError("current_amount cannot exceed target_amount")
        updated = self.repository.update(goal_id, goal)
        if updated is None:
            raise GoalNotFoundError(goal_id)
        return self._enrich(updated)

    def delete_goal(self, goal_id: int) -> bool:
        if not self.repository.delete(goal_id):
            raise GoalNotFoundError(goal_id)
        return True

    def _enrich(self, goal: GoalOut) -> GoalOut:
        target = float(goal.target_amount)
        current = float(goal.current_amount)
        remaining = max(0.0, target - current)
        progress = min(100.0, max(0.0, current / target * 100)) if target else 0.0

        months_remaining = None
        monthly_required = None
        status = "completed" if remaining <= 0 else "active"

        if goal.target_date and remaining > 0:
            target_date = date.fromisoformat(goal.target_date)
            today = date.today()
            if target_date < today:
                status = "overdue"
                months_remaining = 0
                monthly_required = remaining
            else:
                months_remaining = (
                    (target_date.year - today.year) * 12
                    + target_date.month - today.month
                    + (1 if target_date.day >= today.day else 0)
                )
                months_remaining = max(1, months_remaining)
                monthly_required = remaining / months_remaining

        return goal.model_copy(update={
            "progress_percent": round(progress, 2),
            "remaining_amount": round(remaining, 2),
            "monthly_required": (
                round(monthly_required, 2) if monthly_required is not None else None
            ),
            "months_remaining": months_remaining,
            "status": status,
        })
