from fastapi import APIRouter

from app.core.database import get_db
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.analytics_service import AnalyticsService
from app.services.forecast_service import ForecastService

router = APIRouter(tags=["analytics"])


@router.get("/summary")
def get_summary(period: str = "all"):
    conn = get_db()
    try:
        return AnalyticsService(AnalyticsRepository(conn)).get_summary(period)
    finally:
        conn.close()


@router.get("/predict-expense")
def predict_expense():
    conn = get_db()
    try:
        return ForecastService(TransactionRepository(conn)).predict_expense()
    finally:
        conn.close()
