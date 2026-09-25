import os
import time
from collections import defaultdict
from fastapi import HTTPException

_rate_limit = defaultdict(list)
try:
    RATE_LIMIT = max(1, int(os.getenv("RATE_LIMIT_PER_MINUTE", "10")))
except ValueError:
    RATE_LIMIT = 10


def check_rate_limit(client_ip: str | None):
    now = time.time()
    window = now - 60
    client_ip = (client_ip or "unknown").strip() or "unknown"
    timestamps = [t for t in _rate_limit[client_ip] if t > window]
    if len(timestamps) >= RATE_LIMIT:
        raise HTTPException(429, "Rate limit exceeded. Try again in a minute.")
    timestamps.append(now)
    _rate_limit[client_ip] = timestamps
