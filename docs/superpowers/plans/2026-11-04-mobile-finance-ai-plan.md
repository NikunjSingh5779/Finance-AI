# Mobile finance UI and AI research fixes Implementation Plan

> **For agentic workers:** Execute task-by-task using the repository's existing patterns. Each task ends with a focused verification step.

**Goal:** Fix the mobile budget/transaction layouts and improve evidence-grounded market and IPO answers.

**Architecture:** Reuse the existing monthly summary API for budget utilization. Keep source relevance filtering in `WebResearchService`, add bounded query retries and intent-specific search recency in `AIService`, and render citation links safely in the existing markdown renderer.

**Tech Stack:** FastAPI, Python 3.12, SQLite/PostgreSQL adapters, vanilla JavaScript, CSS, pytest, Node syntax checks.

**Spec:** `docs/superpowers/specs/2026-11-04-mobile-finance-ai-design.md`

## Global Constraints
- Preserve the existing dark/green FinanceAI visual system and desktop behavior.
- Never change or delete user financial records.
- Monthly budget spend must come from `/summary?period=1m`, not the selected dashboard range.
- Keep strict named-entity and requested-topic relevance validation for every search result and fetched page.
- Do not introduce paid dependencies or expose provider/database credentials in the frontend.

## Review Focus
- Future-dated transactions must not be counted as current-month spend.
- An expense exactly equal to its limit is “limit reached,” not “over budget.”
- An overrun above 100% must display the true percentage while the bar remains capped visually.
- A page using “RHP” or “Initial Public Offer” terminology must still match an IPO request.
- An explanatory market query must not turn a previous week's decline into a claim that the stock fell in today's session.
- Links must reject non-HTTP(S) schemes and open safely in a new tab.

---

### Task 1: Relevance and AI research regressions

**Files:**
- Modify: `tests/test_web_research_relevance.py`
- Modify: `tests/test_ai_research.py`
- Modify: `tests/test_ai_no_evidence_fallback.py`

**Interfaces:**
- Uses existing public helpers `_query_core_tokens`, `_is_relevant_text`, `AIService._research_query_variants`, and `AIService._research_timelimit`.

- [ ] Add a test that `Jio IPO 2026` core tokens exclude the year.
- [ ] Add tests that RHP / “Initial Public Offer” text is relevant to a Jio IPO query and unrelated Windows/Xbox text is rejected.
- [ ] Add tests that IPO research generates focused alternate queries and that only explanatory market-move questions use a one-week search window.
- [ ] Run the focused pytest files and confirm they fail for the missing behavior before implementing.

### Task 2: Budget usage and mobile transaction layout

**Files:**
- Modify: `app/static/app.js`
- Modify: `app/static/index.html`
- Modify: `app/static/style.css`

**Interfaces:**
- `loadSummary()` will keep `summaryData` for the selected dashboard range and add `budgetSummary` from `GET /summary?period=1m`.
- `renderBudgetContainer(container, categories, detailed)` receives current-month expense category totals only.

- [ ] Render budget amounts with “Spent this month” and “Monthly limit”; compute unrounded utilization from actual monthly spend.
- [ ] Cap only the progress-bar width at 100%; display the actual percentage and overrun amount in text.
- [ ] Group edit/delete into one action wrapper; keep amount and actions aligned on mobile.
- [ ] Remove the duplicate CSS-inserted calendar glyph and make the two date controls share the mobile row.
- [ ] Run `node --check app/static/app.js`.

### Task 3: IPO retrieval and market-move answer grounding

**Files:**
- Modify: `app/services/web_research_service.py`
- Modify: `app/services/ai_service.py`
- Modify: `app/static/app.js`
- Modify: `app/static/style.css`
- Modify: `tests/test_web_research_relevance.py`
- Modify: `tests/test_ai_research.py`

**Interfaces:**
- `WebResearchService` retains its existing `search_and_fetch(query, ...)` interface.
- `AIService._research_query_variants(query, intent)` returns bounded, deduplicated query variants.
- `AIService._research_timelimit(question, intent)` returns `"w"` for explanatory fresh market-move queries, `"d"` for other fresh queries, or `None`.
- The assistant source footer uses standard Markdown links; the frontend renderer only links validated HTTP(S) URLs.

- [ ] Implement the year and IPO vocabulary/entity matching fixes.
- [ ] Retry focused IPO query variants only when the first query yields no relevant sources.
- [ ] Use a seven-day search window for “why did X fall today?” research and instruct the model to reconcile the news date with structured quote direction.
- [ ] Format sources as Markdown links and render them with safe link attributes.
- [ ] Run focused tests, then the full CI suite: `pytest -q`, `flake8 .`, and `node --check app/static/app.js`.

### Final verification
- [ ] Inspect the Git diff for accidental scope changes.
- [ ] Check GitHub Actions CI results for the branch/PR.
- [ ] Report any verification that could not be performed on a physical phone separately from browser/CI checks.
