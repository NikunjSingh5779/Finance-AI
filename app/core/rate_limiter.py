import os
import threading
import time
from collections import defaultdict

from app.core.exceptions import RateLimitError

_request_times: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()


def _limit() -> int:
    try:
        return max(1, int(os.getenv("RATE_LIMIT_PER_MINUTE", "10")))
    except ValueError:
        return 10


def check_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    cutoff = now - 60.0
    key = client_ip or "unknown"

    with _lock:
        timestamps = [t for t in _request_times[key] if t > cutoff]
        if len(timestamps) >= _limit():
            retry_after = max(1, int(60 - (now - timestamps[0])))
            _request_times[key] = timestamps
            raise RateLimitError(retry_after)

        timestamps.append(now)
        _request_times[key] = timestamps


def reset_rate_limiter() -> None:
    """Clear in-memory state for tests and development."""
    with _lock:
        _request_times.clear()
