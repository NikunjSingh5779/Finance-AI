from fastapi import APIRouter, Query

from app.core.database import get_db
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.services.monthly_report_service import MonthlyReportService

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/monthly")
def monthly_report(month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$")):
    conn = get_db()
    try:
        return MonthlyReportService(
            AnalyticsRepository(conn),
            BudgetRepository(conn),
        ).generate(month)
    finally:
        conn.close()
