# FinanceAI V3

FinanceAI V3 introduces reliable session restoration and per-user AI conversation history across the PWA and Expo mobile app.

## Authentication

- Passwords must contain at least 8 characters, one number, and one special character.
- Password fields include a visibility toggle.
- Email signup relies on Supabase email confirmation. Confirm that **Authentication → Sign In / Providers → Confirm email** remains enabled.
- Google sign-in uses Supabase OAuth authorization code with PKCE.
- Refresh-token rotation is serialized. PWA sessions are stored in local storage; native Android sessions are stored in SecureStore.
- Normal logout revokes only the current device session. The separate `POST /auth/logout-all` endpoint revokes all sessions.

### Supabase URL configuration

Add this exact URL under **Authentication → URL Configuration → Redirect URLs**:

```text
financeai://auth/callback
```

Keep the deployed PWA origin and any custom domain in the allowed redirect list as well. The backend native redirect defaults to `financeai://auth/callback`; optionally set this on the Render API service:

```text
MOBILE_AUTH_REDIRECT_URL=financeai://auth/callback
```

The Google provider must be enabled and configured in Supabase. The Google OAuth client should continue to use the Supabase Auth callback URL as its provider redirect URI; the FinanceAI deep link is the post-auth redirect target.

## AI conversation history

The `ai_conversations` and `ai_messages` tables are protected by RLS and owner-scoped API queries.

- Opening AI Assistant always starts a fresh chat.
- Older chats remain available in History and can be restored manually.
- Messages are persisted against the selected conversation.
- Deleting a conversation cascades to its messages.
- Each AI request receives only recent messages from its own conversation, never messages from other chats.

Apply `supabase/migrations/20261105_ai_conversations.sql` to the production Supabase project before deploying the backend. The backend's schema initialization also creates the tables for supported PostgreSQL deployments, but the migration keeps the project migration history explicit.

## Verification checklist

1. Create a new email account and confirm the email before signing in.
2. Reopen the PWA and Android app after the access token has expired; ensure the refresh token rotates and the session remains active.
3. Temporarily disable the network and verify the saved session is not removed.
4. Sign out on one device and confirm another device remains signed in.
5. Sign in with Google on PWA and Android.
6. Create multiple AI chats, log out/in, restore an older chat, and start a fresh chat.
7. Confirm an account cannot list, open, rename, or delete another account's conversations.
