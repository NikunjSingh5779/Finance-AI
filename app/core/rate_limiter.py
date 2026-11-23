import os
import hashlib
import threading
import time
from collections import defaultdict

from app.core.auth import get_current_user_id, is_production
from app.core.database import using_postgres
from app.core.exceptions import RateLimitError

_request_times: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()
_postgres_connection = None
_last_cleanup = 0.0

_POSTGRES_RATE_LIMIT_SQL = """
WITH current_window AS (
    SELECT date_trunc('minute', clock_timestamp()) AS window_start
)
INSERT INTO ai_rate_limit_windows (scope, window_start, request_count)
SELECT %s, window_start, 1
FROM current_window
ON CONFLICT (scope, window_start) DO UPDATE
SET request_count = ai_rate_limit_windows.request_count + 1
WHERE ai_rate_limit_windows.request_count < %s
RETURNING request_count
"""


def _limit() -> int:
    try:
        return max(1, int(os.getenv("RATE_LIMIT_PER_MINUTE", "10")))
    except ValueError:
        return 10


def _scope_keys(client_ip: str) -> list[str]:
    """Apply one shared budget per user and another per client IP."""
    subject = get_current_user_id()
    address_hash = hashlib.sha256(
        (client_ip or "unknown").strip()[:200].encode("utf-8")
    ).hexdigest()
    keys = ["ip:" + address_hash]
    if subject:
        keys.insert(0, "user:" + subject)
    return keys


def _retry_after() -> int:
    return max(1, int(60 - (time.time() % 60)))


def _postgres_conn():
    global _postgres_connection
    if _postgres_connection is not None and not _postgres_connection.closed:
        return _postgres_connection

    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("PostgreSQL rate limiting requires psycopg.") from exc

    _postgres_connection = psycopg.connect(
        os.environ["DATABASE_URL"],
        connect_timeout=5,
        autocommit=True,
    )
    return _postgres_connection


def _check_postgres_rate_limit(scopes: list[str], limit: int) -> None:
    """Atomically consume user and IP quotas shared by every app instance."""
    global _last_cleanup, _postgres_connection
    try:
        with _lock:
            conn = _postgres_conn()
            conn.execute("BEGIN")
            for scope in scopes:
                row = conn.execute(
                    _POSTGRES_RATE_LIMIT_SQL, (scope, limit)
                ).fetchone()
                if row is None:
                    conn.rollback()
                    raise RateLimitError(_retry_after())
            conn.commit()
            now = time.monotonic()
            if now - _last_cleanup >= 300:
                conn.execute(
                    "DELETE FROM ai_rate_limit_windows "
                    "WHERE window_start < clock_timestamp() - INTERVAL '2 hours'"
                )
                _last_cleanup = now
    except RateLimitError:
        raise
    except Exception:
        with _lock:
            if _postgres_connection is not None:
                try:
                    _postgres_connection.close()
                except Exception:
                    pass
            _postgres_connection = None
        raise


def _check_local_rate_limit(scopes: list[str], limit: int) -> None:
    now = time.monotonic()
    cutoff = now - 60.0

    with _lock:
        refreshed: dict[str, list[float]] = {}
        for scope in scopes:
            timestamps = [t for t in _request_times[scope] if t > cutoff]
            if len(timestamps) >= limit:
                retry_after = max(1, int(60 - (now - timestamps[0])))
                for current_scope, current_times in refreshed.items():
                    _request_times[current_scope] = current_times
                _request_times[scope] = timestamps
                raise RateLimitError(retry_after)
            refreshed[scope] = timestamps
        for scope, timestamps in refreshed.items():
            timestamps.append(now)
            _request_times[scope] = timestamps


def check_rate_limit(client_ip: str) -> None:
    """Apply a shared atomic quota in PostgreSQL and a local dev/test fallback."""
    scopes = _scope_keys(client_ip)
    limit = _limit()
    if using_postgres():
        try:
            _check_postgres_rate_limit(scopes, limit)
            return
        except RateLimitError:
            raise
        except Exception:
            # A production limiter must fail closed so an outage cannot expose
            # the expensive free-model endpoints to unlimited use.
            if is_production():
                raise RateLimitError(5)

    _check_local_rate_limit(scopes, limit)


def reset_rate_limiter() -> None:
    """Clear in-memory state for tests and development."""
    global _postgres_connection, _last_cleanup
    with _lock:
        _request_times.clear()
        _last_cleanup = 0.0
        if _postgres_connection is not None:
            try:
                _postgres_connection.close()
            except Exception:
                pass
            _postgres_connection = None
