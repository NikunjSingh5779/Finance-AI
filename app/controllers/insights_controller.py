from fastapi import APIRouter

from app.core.database import get_db
from app.repositories.account_repository import AccountRepository
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.services.insights_service import FinancialHealthService, InsightsService

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/health")
def financial_health():
    conn = get_db()
    try:
        service = FinancialHealthService(
            AnalyticsRepository(conn),
            AccountRepository(conn),
            BudgetRepository(conn),
        )
        return service.get_score()
    finally:
        conn.close()


@router.get("/recurring")
def recurring_expenses():
    conn = get_db()
    try:
        return {"items": InsightsService(AnalyticsRepository(conn)).recurring_expenses()}
    finally:
        conn.close()


@router.get("/anomalies")
def spending_anomalies():
    conn = get_db()
    try:
        return {"items": InsightsService(AnalyticsRepository(conn)).anomalies()}
    finally:
        conn.close()


@router.get("/dashboard")
def insights_dashboard():
    conn = get_db()
    try:
        analytics = AnalyticsRepository(conn)
        health = FinancialHealthService(
            analytics,
            AccountRepository(conn),
            BudgetRepository(conn),
        ).get_score()
        insights = InsightsService(analytics)
        recurring = insights.recurring_expenses()
        anomalies = insights.anomalies()
        return {
            "health": health,
            "recurring": recurring[:5],
            "anomalies": anomalies[:5],
            "counts": {
                "recurring": len(recurring),
                "anomalies": len(anomalies),
            },
        }
    finally:
        conn.close()
