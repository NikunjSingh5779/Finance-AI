from __future__ import annotations

import logging
from fastapi import APIRouter, Request
from database import get_db
from models import AIQuery
from rate_limiter import check_rate_limit
from ai_provider import ask_ai
from sklearn.linear_model import LinearRegression
from web_search import get_searcher
import numpy as np

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/summary")
def get_summary():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT type, SUM(amount) as total FROM transactions GROUP BY type"
        ).fetchall()

        monthly_rows = conn.execute(
            "SELECT substr(date,1,7) as month, type, SUM(amount) as total FROM transactions GROUP BY month, type"
        ).fetchall()

        category_rows = conn.execute(
            "SELECT category, SUM(amount) as total FROM transactions WHERE type='expense' GROUP BY category"
        ).fetchall()

        income = expense = 0.0
        for r in rows:
            if r["type"] == "income":
                income = r["total"]
            else:
                expense = r["total"]

        monthly = {}
        for r in monthly_rows:
            m = r["month"]
            if m not in monthly:
                monthly[m] = {"income": 0, "expense": 0}
            monthly[m][r["type"]] = r["total"]

        category_totals = {r["category"]: r["total"] for r in category_rows}

        return {
            "income": round(income, 2),
            "expense": round(expense, 2),
            "balance": round(income - expense, 2),
            "savings_rate": round((income - expense) / income * 100, 1) if income else 0,
            "monthly": monthly,
            "category_totals": category_totals
        }
    finally:
        conn.close()


@router.get("/predict-expense")
def predict_expense():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT date, amount FROM transactions WHERE type='expense' ORDER BY date"
        ).fetchall()

        if len(rows) < 2:
            return {"prediction": "Not enough data"}

        X = np.array(range(len(rows))).reshape(-1, 1)
        y = np.array([r["amount"] for r in rows])

        model = LinearRegression()
        model.fit(X, y)

        next_val = model.predict([[len(rows)]])[0]

        return {"predicted_expense": round(float(next_val), 2)}
    finally:
        conn.close()


@router.post("/ai/advice")
def ai_advice(query: AIQuery, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip)
    q = query.question.lower().strip()

    if len(q) < 3 or not any(c.isalpha() for c in q):
        return {"advice": "Ask a meaningful financial question."}

    summary = query.summary
    budgets = query.budgets

    income = summary.get("income", 0)
    expenses = summary.get("expense", 0)
    balance = summary.get("balance", 0)
    savings = summary.get("savings_rate", 0)
    categories = summary.get("category_totals", {})

    if "save" in q or "saving" in q:

        if savings >= 35:
            return {
                "advice": f"""
Your savings rate is {savings}%, which is excellent.

Focus now on wealth growth:
- Build 6 month emergency fund
- Invest 60% in equity mutual funds (SIP)
- 20% in index funds
- 10% in debt
- 10% high-risk assets (optional)
"""
            }

        elif savings >= 20:
            return {
                "advice": f"""
Your savings rate is {savings}%, which is good.

Start investing consistently:
- Begin SIP
- Avoid idle cash
- Maintain discipline
"""
            }

        else:
            return {
                "advice": f"""
Your savings rate is {savings}%, which is low.

Improve by:
- Reducing expenses
- Avoiding impulse spending
- Target at least 20%
"""
            }

    elif "spending" in q or "overspending" in q:

        if not categories:
            return {"advice": "No spending data available."}

        top_cat = max(categories, key=categories.get)
        amt = categories[top_cat]

        return {
            "advice": f"""
You are overspending in {top_cat} (₹{amt}).

Reduce this category to improve savings and investment capacity.
"""
        }

    elif "budget" in q:

        if not budgets:
            return {"advice": "No budgets set yet."}

        messages = []

        for b in budgets:
            cat = b.get("category")
            limit = b.get("limit_amt", 0)
            spent = categories.get(cat, 0)

            if spent > limit:
                messages.append(f"{cat}: Exceeded by ₹{spent - limit}")
            elif spent > 0.8 * limit:
                messages.append(f"{cat}: Near limit")

        if messages:
            return {"advice": "\n".join(messages)}
        else:
            return {"advice": "All budgets are under control."}

    else:
        detailed = "explain" in q or "detailed" in q

        system_prompt = """You are a professional financial advisor.

Give a COMPLETE but CONCISE answer.

Rules:
- Use bullet points
- Max 6-8 lines
- Focus on actionable advice"""

        user_prompt = f"""
Income: ₹{income}
Expenses: ₹{expenses}
Balance: ₹{balance}
Savings Rate: {savings}%

User Question: {query.question}
"""

        max_tokens = 500 if detailed else 350  # Increased for complete financial advice

        return {"advice": ask_ai(system_prompt, user_prompt, max_tokens)}


# ---------------------------------------------------------------------------
# Enhanced AI Advisor with Web Search Context
# ---------------------------------------------------------------------------

@router.post("/ai/advice-enhanced")
async def ai_advice_enhanced(query: AIQuery, request: Request):
    """AI financial advice enriched with web search market context."""
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip)
    q = query.question.lower().strip()

    if len(q) < 3 or not any(c.isalpha() for c in q):
        return {"advice": "Ask a meaningful financial question."}

    summary = query.summary
    budgets = query.budgets

    income = summary.get("income", 0)
    expenses = summary.get("expense", 0)
    balance = summary.get("balance", 0)
    savings = summary.get("savings_rate", 0)
    categories = summary.get("category_totals", {})

    # Check for simple keyword-based advice first (same as base endpoint)
    if "save" in q or "saving" in q:
        if savings >= 35:
            return {
                "advice": (
                    f"Your savings rate is excellent ({savings}%). Focus on wealth growth: "
                    "60% equity SIP, 20% index funds, 10% debt, 10% high-risk."
                )
            }
        elif savings >= 20:
            return {
                "advice": (
                    f"Your savings rate is good ({savings}%). "
                    "Start investing consistently, avoid idle cash."
                )
            }
        else:
            return {
                "advice": (
                    f"Your savings rate is low ({savings}%). "
                    "Reduce expenses, avoid impulse spending, target 20%+."
                )
            }

    if "spending" in q or "overspending" in q:
        if not categories:
            return {"advice": "No spending data available."}
        top_cat = max(categories, key=categories.get)
        return {
            "advice": (
                f"You are overspending in {top_cat} (₹{categories[top_cat]}). "
                "Reduce this category to improve savings."
            )
        }

    if "budget" in q:
        if not budgets:
            return {"advice": "No budgets set yet."}
        messages = []
        for b in budgets:
            cat = b.get("category")
            limit = b.get("limit_amt", 0)
            spent = categories.get(cat, 0)
            if spent > limit:
                messages.append(f"{cat}: Exceeded by ₹{spent - limit}")
            elif spent > 0.8 * limit:
                messages.append(f"{cat}: Near limit")
        if messages:
            return {"advice": "\n".join(messages)}
        return {"advice": "All budgets are under control."}

    # For general questions, fetch web context for enriched advice
    detailed = "explain" in q or "detailed" in q

    # Try to fetch financial news context from web search
    web_context = ""
    try:
        searcher = get_searcher()

        # Extract key terms for search
        search_terms = q
        # Look for potential stock tickers in the query
        import re
        tickers = re.findall(r'\b[A-Z]{1,5}\b', q)
        # Filter out common non-ticker words
        common_words = {"I", "A", "AN", "THE", "MY", "IN", "ON", "AT", "TO", "FOR",
                        "OF", "IS", "IT", "BE", "BY", "OR", "AS", "IF", "ME", "DO",
                        "NO", "SO", "UP", "US", "GO", "SAVE", "BUDGET", "BUY", "SELL",
                        "HOW", "WHAT", "WHY", "WHEN", "WHERE", "CAN", "GET", "MAKE"}
        real_tickers = [t for t in tickers if t not in common_words and len(t) >= 2]

        # Search for financial context
        if real_tickers:
            # Search for news about detected tickers
            news_results = await searcher.search_financial_news(real_tickers[0], max_results=3)
            if news_results:
                web_context = "Recent Market News:\n"
                for n in news_results:
                    web_context += f"- {n.get('title', '')}: {n.get('snippet', '')[:150]}\n"

        # Always try to get macro-economic context for the query
        macro_results = await searcher.search(search_terms, max_results=3)
        if macro_results:
            if web_context:
                web_context += "\nRelated Financial Context:\n"
            else:
                web_context = "Related Financial Context:\n"
            for r in macro_results[:2]:
                web_context += f"- {r.title}: {r.snippet[:150]}\n"

    except ImportError:
        logger.debug("Web search not available, skipping context")
    except Exception as e:
        logger.warning(f"Web search failed: {e}")

    # Build the enriched prompt
    system_prompt = """You are a professional financial advisor with access to web search context.

    Give a COMPLETE but CONCISE answer using the financial data and web context below.

    Rules:
    - Use bullet points
    - Max 6-8 lines
    - Focus on actionable advice
    - Incorporate recent news/market context when relevant
    - If web search failed, rely on the user's financial data"""

    user_prompt = f"""
    Financial Profile:
    - Income: ₹{income}
    - Expenses: ₹{expenses}
    - Savings Rate: {savings}%
    - Balance: ₹{balance}

    {web_context if web_context else "(Web search context unavailable)"}

    User Question: {query.question}
    """

    max_tokens = 600 if detailed else 400  # Increased for complete financial advice

    return {"advice": ask_ai(system_prompt, user_prompt, max_tokens)}
