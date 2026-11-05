-- Recurring archive state is non-destructive; linked transactions remain intact.
ALTER TABLE public.recurring_items
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_recurring_items_user_archive_due
    ON public.recurring_items(
        user_id,
        is_archived,
        is_active,
        next_due_date
    );
