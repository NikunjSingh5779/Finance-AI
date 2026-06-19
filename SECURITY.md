# Security Policy

## Reporting a vulnerability

If you discover a security issue, please do **not** open a public issue. Send a private message to the repo owner directly or open a [GitHub Security Advisory](https://github.com/NikunjSingh5779/Finance-AI/security/advisories/new).

## API key safety

This application uses LLM API keys (OpenAI, Claude, OpenRouter) stored in `.env`. Never commit `.env` to version control. If you suspect a key has been exposed, revoke it immediately and generate a replacement.
