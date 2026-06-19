# Contributing

Thanks for your interest in improving Finance AI.

## Getting started

1. Fork the repo.
2. Create a feature branch: `git checkout -b feat/my-change`
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and add at least one LLM API key.
5. Start the server: `uvicorn main:app --reload`
6. Open `http://localhost:8000`.

## Running tests

```bash
pip install pytest
pytest -v
```

## Linting

```bash
pip install flake8
flake8 .
```

## Before submitting a PR

- All existing tests pass.
- New features include tests under `tests/`.
- Code passes `flake8 .` without warnings.
- The app runs and the frontend loads without console errors.

## Commit style

Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
