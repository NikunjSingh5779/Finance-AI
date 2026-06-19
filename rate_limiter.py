import os
import time
from collections import defaultdict
from fastapi import HTTPException

_rate_limit = defaultdict(list)
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "10"))


def check_rate_limit(client_ip: str):
    now = time.time()
    window = now - 60
    _rate_limit[client_ip] = [t for t in _rate_limit[client_ip] if t > window]
    if len(_rate_limit[client_ip]) >= RATE_LIMIT:
        raise HTTPException(429, "Rate limit exceeded. Try again in a minute.")
    _rate_limit[client_ip].append(now)
