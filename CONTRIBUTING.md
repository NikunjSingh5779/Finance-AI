# Contributing

Thanks for helping improve FinanceAI.

## Getting started

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-change`
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and configure AI only when needed.
5. Start the server: `python -m uvicorn app.main:app --reload`
6. Open `http://localhost:8000`.

## Architecture

Keep the dependency direction:

~~~text
Controllers → Services → Repositories / Providers
                              ↓
                         SQLite / APIs
~~~

Controllers should contain HTTP orchestration only. Business rules belong in services. SQLite access belongs in repositories. External integrations belong in providers.

## Running tests

~~~bash
pytest -q
~~~

## Linting

~~~bash
flake8 .
~~~

## Before submitting a PR

- Existing tests pass.
- New features include regression tests.
- Code passes flake8.
- The application imports and starts successfully.
- The frontend loads without console errors.
- No secrets, databases, or generated validation reports are committed.

## Commit style

Use conventional commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, and `chore:`.
