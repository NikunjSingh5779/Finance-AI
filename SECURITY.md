# Security Policy

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue. Use a private GitHub Security Advisory or contact the repository owner privately.

## API key safety

FinanceAI supports optional OmniRoute, OpenCode Zen, and OpenRouter credentials. Store them in a local `.env` file and never commit that file.

If a credential is exposed, revoke it immediately and issue a replacement.

## Financial data

The application stores personal finance records in SQLite. Protect `finance.db` and any backups with appropriate local filesystem access controls.

Do not share exported transaction data, AI prompts, or provider logs publicly if they contain personal financial information.
