# Mobile finance UI and AI research fixes — design

**Date:** 2026-11-04

## Intent
Correct the mobile budget and transaction layouts shown in the supplied screenshots, and make current-information answers more reliable without allowing unrelated web pages to pass source validation.

## Goals
- Budget usage always compares the current calendar month's expenses with a monthly limit, independent of the dashboard's global date-range selector.
- Over-budget cards show the true percentage and amount over the limit; the visual bar may fill at 100% but must not misreport utilization.
- Transaction edit/delete actions remain in one compact, usable action group on narrow screens.
- Mobile date-range controls do not duplicate calendar icons and use the available width.
- IPO research accepts common filing terminology and retries focused company-name queries before returning an evidence failure.
- Explanatory stock-movement queries can retrieve relevant reporting from the last seven days and the assistant reconciles reported direction with structured quote data.
- Research sources are rendered as safe, clickable links.

## Non-goals
- Do not redesign the product's visual identity or alter desktop information architecture.
- Do not mutate, migrate, delete, or reassign any user's financial records.
- Do not relax entity/topic validation enough to admit unrelated results.
- Do not add paid search or AI dependencies.

## Approaches
1. **Client-only budget aggregation:** calculate budget usage from the browser's transaction cache. Rejected because it duplicates date and accounting rules and risks diverging from the API's period semantics.
2. **Existing summary API (chosen):** request the already-supported `/summary?period=1m` alongside the selected dashboard summary, then render budget usage from that server-calculated category total. This is small, per-user, and leaves persistence untouched.
3. **New budget aggregation endpoint:** useful if the product later needs richer budget projections, but unnecessary for this screen because the existing monthly summary already returns category totals.

For AI research, keep strict relevance checks and add semantic IPO vocabulary, targeted retry queries, and a one-week search window only for explanatory market-move questions. This preserves the safety property of the existing filter.

## UX and visual direction
Operate-mode refinement. Preserve the existing dark surfaces, green primary accent, spacing scale, and typography. Improve mobile layout through structural grid changes, minimum touch sizes, clearer budget labels, and compact action grouping. Keep source links understated and keyboard-visible.

## Constraints
- Existing FastAPI + SQLite/Postgres repository adapters and vanilla JavaScript frontend.
- Multi-user access remains enforced by the existing authenticated request path and database row-level security.
- No AI or database secrets move to the browser.
- Existing tests and CI commands remain authoritative.
