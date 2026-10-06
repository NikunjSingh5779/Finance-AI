"""Date utility functions for the Finance AI application."""

from datetime import datetime, timedelta
from typing import Tuple


def get_period_bounds(period: str) -> Tuple[str, str]:
    """
    Get start and end dates for a given period.

    Args:
        period: One of "1m", "3m", "6m", "1y", "all"

    Returns:
        Tuple of (start_date, end_date) in YYYY-MM-DD format
    """
    today = datetime.now()

    if period == "1m":
        # Current month
        start = today.replace(day=1)
        end = today
    elif period == "3m":
        # Last 3 months
        start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        start = (start - timedelta(days=1)).replace(day=1)
        end = today
    elif period == "6m":
        # Last 6 months
        start = today.replace(day=1)
        for _ in range(5):
            start = (start - timedelta(days=1)).replace(day=1)
        end = today
    elif period == "1y":
        # Last 12 months
        start = today.replace(day=1)
        for _ in range(11):
            start = (start - timedelta(days=1)).replace(day=1)
        end = today
    elif period == "all":
        # All time - use a very early date
        start = datetime(2000, 1, 1)
        end = today
    else:
        # Default to current month
        start = today.replace(day=1)
        end = today

    return (start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))


def get_previous_period_bounds(period: str) -> Tuple[str, str]:
    """
    Get start and end dates for the previous period (for comparison).

    Args:
        period: One of "1m", "3m", "6m", "1y"

    Returns:
        Tuple of (start_date, end_date) in YYYY-MM-DD format
    """
    today = datetime.now()

    if period == "1m":
        # Previous month
        first_this_month = today.replace(day=1)
        end = first_this_month - timedelta(days=1)
        start = end.replace(day=1)
    elif period == "3m":
        # 3 months before the current 3-month period
        first_this_month = today.replace(day=1)
        end = first_this_month - timedelta(days=1)
        start = end.replace(day=1)
        for _ in range(2):
            start = (start - timedelta(days=1)).replace(day=1)
    elif period == "6m":
        # 6 months before the current 6-month period
        first_this_month = today.replace(day=1)
        end = first_this_month - timedelta(days=1)
        start = end.replace(day=1)
        for _ in range(5):
            start = (start - timedelta(days=1)).replace(day=1)
    elif period == "1y":
        # 12 months before the current 12-month period
        first_this_month = today.replace(day=1)
        end = first_this_month - timedelta(days=1)
        start = end.replace(day=1)
        for _ in range(11):
            start = (start - timedelta(days=1)).replace(day=1)
    else:
        start = today.replace(day=1)
        end = today

    return (start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))


def parse_date(date_str: str) -> datetime:
    """Parse a date string in YYYY-MM-DD format."""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise ValueError("Date must be in YYYY-MM-DD format")


def format_date(dt: datetime) -> str:
    """Format a datetime as YYYY-MM-DD string."""
    return dt.strftime("%Y-%m-%d")