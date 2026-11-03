# FinanceAI multi-user deployment

FinanceAI now supports authenticated multi-user workspaces.

## Production architecture

- Auth: Supabase Auth
- API: FastAPI on Render
- Database: Supabase PostgreSQL
- Isolation: PostgreSQL Row Level Security (RLS)
- AI: OpenRouter, OpenCode Zen, or another configured provider
- Clients: Netlify web app and Expo mobile app

Every finance record has a user_id. Production requests are authenticated with a Supabase access token, the backend verifies the token, and PostgreSQL policies restrict rows to the authenticated user.

## Supabase setup

1. Create a Supabase project.
2. Enable Email/Password authentication.
3. Open SQL Editor and run supabase/migrations/20261104_multiuser.sql.
4. Keep the project's JWT signing configuration on an asymmetric algorithm when possible so the backend can verify tokens through the Supabase JWKS endpoint.

## Render environment

```text
AUTH_REQUIRED=true
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
DATABASE_URL=YOUR_SUPABASE_POSTGRES_CONNECTION_STRING

OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
OPENROUTER_MODEL=openrouter/free

PORT=8000
RATE_LIMIT_PER_MINUTE=10
CORS_ORIGINS=https://finance-ai-z0z6.netlify.app
```

Do not commit any of these secrets.

## Migrate the existing personal database

First run the Supabase schema.

Then from a secure machine that has access to both databases:


```powershell
$env:SOURCE_DB_PATH="C:\path\to\finance.db"
$env:DATABASE_URL="YOUR_SUPABASE_POSTGRES_CONNECTION_STRING"
$env:TARGET_USER_ID="YOUR_SUPABASE_AUTH_USER_UUID"

python scripts/migrate_sqlite_to_postgres.py
```

The migration assigns the existing records to the selected Supabase Auth user.

## Web client

Configure the Netlify environment variable:


```text
FINANCEAI_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

Redeploy Netlify after changing it.

The web client handles sign-in/sign-up and sends the authenticated access token on FinanceAI API requests.

## Mobile client

For local development:


```env
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000
```

For the deployed application:


```env
EXPO_PUBLIC_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

The Expo client persists the auth session in device storage and refreshes expired sessions through the backend.

## Local development

To keep the old SQLite-based development workflow:


```env
AUTH_REQUIRED=false
DB_PATH=finance.db
DEV_USER_ID=00000000-0000-0000-0000-000000000001
```

When PostgreSQL is configured with DATABASE_URL, the backend switches to the multi-user production database path.

## Important


Do not run a public multi-user deployment with:


```text
AUTH_REQUIRED=true
DATABASE_URL unset
```


That would authenticate users while still using the local SQLite backend. Production multi-user deployments must use PostgreSQL/Supabase so row-level isolation is enforced.