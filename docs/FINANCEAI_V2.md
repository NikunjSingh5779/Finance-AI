# FinanceAI V2

## What changed

FinanceAI V2 adds a recurring payments manager in the FinanceAI PWA.

- Create weekly, monthly and yearly schedules for expenses or income.
- Optionally associate a schedule with one of the user's own accounts.
- Review the next due date and pause or resume a schedule.
- Explicitly record an occurrence as paid or received. The backend creates the transaction and advances the schedule atomically.
- Duplicate or stale due-date submissions are rejected.
- Schedules with recorded transaction history cannot be deleted; they can be paused to preserve the audit trail.
- Monthly schedules preserve the selected day across short months (January 31 → February 28 → March 31).

## Safety model

No background job or service worker automatically inserts financial transactions. Marking a due item paid/received is an explicit user action. The recurring schedule table follows the same authenticated-user RLS model as the existing finance tables. The PWA offline cache continues to hold only static application-shell assets.

## Database

SQLite creates the recurring table and transaction link during normal idempotent initialization. For hosted Supabase/Postgres deployments, apply:

`supabase/migrations/20261105_recurring_payments.sql`

## API

- `GET /recurring`
- `POST /recurring`
- `GET /recurring/{id}`
- `PUT /recurring/{id}`
- `DELETE /recurring/{id}` (only when no transaction history is attached)
- `POST /recurring/{id}/record` with `{"due_date":"YYYY-MM-DD"}`

The record endpoint returns the updated schedule and the transaction it created.
