"""Date utility functions for FinanceAI."""

from datetime import datetime, timedelta


def get_period_bounds(period: str) -> tuple[str, str]:
    """Return current-period start/end dates in YYYY-MM-DD format."""
    today = datetime.now()

    if period == "1m":
        start = today.replace(day=1)
    elif period == "3m":
        start = today.replace(day=1)
        for _ in range(2):
            start = (start - timedelta(days=1)).replace(day=1)
    elif period == "6m":
        start = today.replace(day=1)
        for _ in range(5):
            start = (start - timedelta(days=1)).replace(day=1)
    elif period == "1y":
        start = today.replace(day=1)
        for _ in range(11):
            start = (start - timedelta(days=1)).replace(day=1)
    elif period == "all":
        start = datetime(2000, 1, 1)
    else:
        raise ValueError(
            f"Unsupported period '{period}'. "
            "Use one of: 1m, 3m, 6m, 1y, all."
        )

    return start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")


def get_previous_period_bounds(period: str) -> tuple[str, str]:
    """Return the period immediately preceding the requested period."""
    if period == "all":
        raise ValueError("Previous period is not defined for all-time data.")

    current_start, _ = get_period_bounds(period)
    current_first = datetime.strptime(current_start, "%Y-%m-%d")
    current_periods = {"1m": 1, "3m": 3, "6m": 6, "1y": 12}
    months = current_periods[period]

    previous_end = current_first - timedelta(days=1)
    previous_start = previous_end.replace(day=1)

    for _ in range(months - 1):
        previous_start = (
            previous_start - timedelta(days=1)
        ).replace(day=1)

    return (
        previous_start.strftime("%Y-%m-%d"),
        previous_end.strftime("%Y-%m-%d"),
    )


def parse_date(date_str: str) -> datetime:
    """Parse a date string in YYYY-MM-DD format."""
    return datetime.strptime(date_str, "%Y-%m-%d")


def format_date(dt: datetime) -> str:
    """Format a datetime as YYYY-MM-DD string."""
    return dt.strftime("%Y-%m-%d")
