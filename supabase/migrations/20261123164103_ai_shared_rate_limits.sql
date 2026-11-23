-- Shared API quotas are only consumed by the backend database connection.
CREATE TABLE IF NOT EXISTS public.ai_rate_limit_windows (
    scope           TEXT NOT NULL,
    window_start    TIMESTAMPTZ NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    PRIMARY KEY (scope, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_rate_limit_windows_expiry
    ON public.ai_rate_limit_windows(window_start);

ALTER TABLE public.ai_rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_rate_limit_windows FROM PUBLIC, anon, authenticated;
