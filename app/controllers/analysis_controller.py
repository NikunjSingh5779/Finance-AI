from fastapi import APIRouter, Request
from app.core.database import get_db
from app.repositories.transaction_repository import TransactionRepository
from app.services.analytics_service import AnalyticsService
from app.services.ai_service import AIService
from app.services.forecast_service import ForecastService
from app.models import AIQuery
from app.core.rate_limiter import check_rate_limit
from app.utils.web_search import get_searcher

router = APIRouter()


@router.get("/summary")
def get_summary(period: str = "all"):
    conn = get_db()
    try:
        repo = TransactionRepository(conn)
        service = AnalyticsService(repo)
        return service.get_summary(period)
    finally:
        conn.close()


@router.get("/predict-expense")
def predict_expense():
    conn = get_db()
    try:
        repo = TransactionRepository(conn)
        forecast_service = ForecastService(repo)
        return forecast_service.predict_expense()
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

        # TODO: Replace with AIService when implemented
        from app.core.ai_provider import ask_ai
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
                    "Start SIP, avoid idle cash, maintain discipline."
                )
            }

        else:
            return {
                "advice": (
                    f"Your savings rate is low ({savings}%). "
                    "Reduce expenses, avoid impulse spending, target 20%+ savings."
                )
            }

    elif "spending" in q or "overspending" in q:
        if not categories:
            return {"advice": "No spending data available."}

        top_cat = max(categories, key=categories.get)
        amt = categories[top_cat]

        return {
            "advice": (
                f"You are overspending in {top_cat} (₹{amt}). "
                "Reduce this category to improve savings and investment capacity."
            )
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
                messages.append(f"{cat}: Near limit (₹{spent}/₹{limit})")

        if messages:
            return {"advice": "\n".join(messages)}
        else:
            return {"advice": "All budgets are under control."}

    else:
        # Enhanced AI advice with web search and market context
        try:
            # Initialize services
            repo = TransactionRepository(conn)
            analytics_service = AnalyticsService(repo)
            ai_service = AIService()
            forecast_service = ForecastService(repo)
            market_service = None  # TODO: Implement market service
            searcher = get_searcher()

            # Build comprehensive context
            context = await _build_ai_context(
                analytics_service, ai_service, forecast_service, market_service, searcher, query
            )

            # Get AI advice
            advice = await ai_service.get_financial_advice(
                question=query.question,
                context=context
            )

            return {"advice": advice, "success": True}

        except Exception as e:
            # Fallback to basic AI advice
            from app.core.ai_provider import ask_ai
            system_prompt = """You are a helpful personal finance assistant.
            Provide practical financial advice based on the user's question."""
            user_prompt = f"""{query.question}"""
            return {"advice": ask_ai(system_prompt, user_prompt, 350), "success": False}


async def _build_ai_context(
    analytics_service: AnalyticsService,
    ai_service: AIService,
    forecast_service: ForecastService,
    market_service,  # TODO: Implement
    searcher,
    query: AIQuery
) -> dict:
    """Build comprehensive context for AI advice."""
    context = {
        "financial_summary": analytics_service.get_summary("all"),
        "monthly_trends": analytics_service.get_monthly_series(6),
        "user_question": query.question
    }

    # Add optional context if available
    if query.summary:
        context.update({
            "current_period_summary": query.summary,
            "budgets": query.budgets
        })

    # TODO: Add forecast, market data, web search results when services are implemented

    return context