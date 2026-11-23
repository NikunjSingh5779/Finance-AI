# FinanceAI multi-user deployment

FinanceAI is delivered as a PWA, with a separate FastAPI backend and Supabase-managed identity and persistence.

## Production architecture

- Client: FinanceAI PWA on Cloudflare Pages
- API: FastAPI on Render
- Auth: Supabase Auth
- Database: Supabase PostgreSQL
- Isolation: PostgreSQL Row Level Security (RLS)
- AI: explicitly verified free OpenRouter, OpenCode Zen, or OmniRoute routes

Every finance record has a `user_id`. Production requests are authenticated with a Supabase access token, the backend verifies the token, and PostgreSQL policies restrict rows to the authenticated user.

## Supabase setup

1. Create a Supabase project.
2. Enable Email/Password authentication and email confirmation.
3. Configure Google OAuth if Google sign-in is required.
4. Add the production PWA origin to Authentication → URL Configuration → Redirect URLs.
5. Apply the SQL migrations in `supabase/migrations/`.

## Render environment

```text
AUTH_REQUIRED=true
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
DATABASE_URL=YOUR_SUPABASE_POSTGRES_CONNECTION_STRING

OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
OPENROUTER_MODEL=openrouter/free
# Optional exact free model IDs for metadata outages or additional verified fallbacks.
# If OpenRouter pricing metadata is available, configured models must still be
# listed at zero input and output price by its /models endpoint.
OPENROUTER_FREE_MODELS=

PORT=8000
RATE_LIMIT_PER_MINUTE=10
CORS_ORIGINS=https://finance-ai-61h.pages.dev
```

Do not commit any of these secrets.

### Free-only AI routes

The API never falls back to a paid model. OpenRouter checks the configured model
against current input and output pricing metadata before sending a completion.
If its pricing endpoint is unavailable, set `OPENROUTER_FREE_MODELS` to the
exact model ID only after verifying that route is free. A model listed as paid
or absent from available pricing metadata is rejected.

For providers without a pricing endpoint, the operator must declare the exact
free route. `OPENCODE_MODEL` must match an entry in `OPENCODE_FREE_MODELS`, and
`OMNIROUTE_COMBO_NAME` (or `OMNIROUTE_MODEL`) must match an entry in
`OMNIROUTE_FREE_COMBOS`. Use comma-separated exact IDs when listing more than
one route. These allowlists are your assertion that each configured route is
free; the app disables providers with no matching entry. If no verified free
provider is available, chat returns an unavailable message instead of using a
paid route.

### Streaming and shared limits

Chat clients use `POST /api/conversations/{conversation_id}/messages/stream`
for Server-Sent Events. The existing JSON endpoint remains available for older
clients. A streamed assistant message is saved only after generation completes.
PostgreSQL stores atomic per-user and per-IP request windows in the server-only
`ai_rate_limit_windows` table, which is created during startup. Production
startup requires Supabase Auth configuration and a PostgreSQL `DATABASE_URL`.

Research work is bounded by `AI_RESEARCH_MAX_QUERIES` (default 2, maximum 3)
and `AI_RESEARCH_TIMEOUT_SECONDS` (default 10 seconds). Provider generation is
bounded by `AI_PROVIDER_TOTAL_TIMEOUT_SECONDS` (default 30 seconds) and
`AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS` (default 15 seconds).

## Migrate the existing personal database

From a secure machine that has access to both databases:

```powershell
$env:SOURCE_DB_PATH="C:\path\to\finance.db"
$env:DATABASE_URL="YOUR_SUPABASE_POSTGRES_CONNECTION_STRING"
$env:TARGET_USER_ID="YOUR_SUPABASE_AUTH_USER_UUID"

python scripts/migrate_sqlite_to_postgres.py
```

The migration assigns the existing records to the selected Supabase Auth user.

## Cloudflare Pages PWA

The GitHub Actions workflow builds the static PWA into `netlify-dist/` and deploys it to Cloudflare Pages. Configure these GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The workflow injects the public API origin:

```text
FINANCEAI_API_URL=https://finance-ai-u9bo.onrender.com
```

The PWA handles sign-in/sign-up, persists its web session, and sends the authenticated access token on FinanceAI API requests.

## Local development

```env
AUTH_REQUIRED=false
DB_PATH=finance.db
DEV_USER_ID=00000000-0000-0000-0000-000000000001
```

When PostgreSQL is configured with `DATABASE_URL`, the backend switches to the multi-user production database path.

## Important

Do not run a public multi-user deployment with `AUTH_REQUIRED=true` and `DATABASE_URL` unset. That would authenticate users while still using the local SQLite backend. Production multi-user deployments must use PostgreSQL/Supabase so row-level isolation is enforced.
