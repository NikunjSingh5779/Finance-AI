# FinanceAI V3

FinanceAI V3 delivers reliable PWA session restoration and per-user AI conversation history.

## Authentication

- Passwords require at least 8 characters, one number, and one special character.
- Password fields include a visibility toggle.
- Email signup relies on Supabase email confirmation.
- Google sign-in uses Supabase OAuth authorization code with PKCE.
- Refresh-token rotation is serialized, and the PWA keeps its session during transient network/API failures.
- Normal logout revokes the current session; `POST /auth/logout-all` explicitly revokes all sessions.

## Supabase URL configuration

The Supabase redirect allow-list should include the production PWA URL, for example:

```text
https://finance-ai-61h.pages.dev/**
```

Also retain any custom production domain or required localhost development URL. Native deep links are not used by the PWA-only product.

## AI conversation history

The `ai_conversations` and `ai_messages` tables are protected by RLS and owner-scoped API queries.

- Opening AI Assistant always starts a fresh chat.
- Older chats remain available in History and can be restored manually.
- Messages persist against the selected conversation.
- Deleting a conversation cascades to its messages.
- Each AI request receives only messages from its own conversation.

Apply `supabase/migrations/20261105_ai_conversations.sql` to production Supabase. The migration is already recorded in the current production project.

## Verification checklist

1. Create a new email account and confirm the email before signing in.
2. Reopen the PWA after the access token expires; ensure the refresh token rotates and the session remains active.
3. Temporarily disable the network and verify the saved session is not removed.
4. Sign out and back in; confirm the account's saved AI conversations remain available.
5. Sign in with Google through the PWA.
6. Create multiple AI chats, restore an older chat, and start a fresh chat.
7. Confirm one account cannot list, open, rename, or delete another account's conversations.
