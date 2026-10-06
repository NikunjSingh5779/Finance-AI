from sqlite3 import Connection

from app.schemas.goal import GoalCreate, GoalOut, GoalUpdate


class GoalRepository:
    """Persistence operations for financial goals."""

    def __init__(self, conn: Connection):
        self.conn = conn

    def _map(self, row) -> GoalOut:
        target = float(row["target_amount"])
        current = float(row["current_amount"])
        progress = min(100.0, max(0.0, current / target * 100)) if target else 0.0
        return GoalOut(
            id=row["id"],
            name=row["name"],
            target_amount=target,
            current_amount=current,
            target_date=row["target_date"],
            category=row["category"],
            progress_percent=round(progress, 2),
            remaining_amount=round(max(0.0, target - current), 2),
            monthly_required=None,
            months_remaining=None,
            status="active",
            created=row["created"],
        )

    def list(self) -> list[GoalOut]:
        rows = self.conn.execute(
            "SELECT * FROM goals ORDER BY target_date IS NULL, target_date, id DESC"
        ).fetchall()
        return [self._map(row) for row in rows]

    def get(self, goal_id: int) -> GoalOut | None:
        row = self.conn.execute(
            "SELECT * FROM goals WHERE id = ?", (goal_id,)
        ).fetchone()
        return self._map(row) if row else None

    def create(self, goal: GoalCreate) -> GoalOut:
        cursor = self.conn.execute(
            """
            INSERT INTO goals (name, target_amount, current_amount, target_date, category)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                goal.name,
                goal.target_amount,
                goal.current_amount,
                goal.target_date,
                goal.category,
            ),
        )
        self.conn.commit()
        created = self.get(cursor.lastrowid)
        if created is None:
            raise RuntimeError("Failed to retrieve created goal")
        return created

    def update(self, goal_id: int, goal: GoalUpdate) -> GoalOut | None:
        if self.get(goal_id) is None:
            return None
        data = goal.model_dump(exclude_unset=True)
        if not data:
            return self.get(goal_id)
        allowed = {"name", "target_amount", "current_amount", "target_date", "category"}
        data = {key: value for key, value in data.items() if key in allowed}
        assignments = ", ".join(f"{key} = ?" for key in data)
        values = [*data.values(), goal_id]
        self.conn.execute(
            f"UPDATE goals SET {assignments} WHERE id = ?", values
        )
        self.conn.commit()
        return self.get(goal_id)

    def delete(self, goal_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM goals WHERE id = ?", (goal_id,)
        )
        self.conn.commit()
        return cursor.rowcount > 0
