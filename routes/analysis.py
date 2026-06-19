from fastapi import APIRouter, Request
from database import get_db
from models import AIQuery
from rate_limiter import check_rate_limit
from ai_provider import ask_ai
from sklearn.linear_model import LinearRegression
import numpy as np

router = APIRouter()


@router.get("/summary")
def get_summary():
    conn = get_db()

    rows = conn.execute(
        "SELECT type, SUM(amount) as total FROM transactions GROUP BY type"
    ).fetchall()

    monthly_rows = conn.execute(
        "SELECT substr(date,1,7) as month, type, SUM(amount) as total FROM transactions GROUP BY month, type"
    ).fetchall()

    category_rows = conn.execute(
        "SELECT category, SUM(amount) as total FROM transactions WHERE type='expense' GROUP BY category"
    ).fetchall()

    conn.close()

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


@router.get("/predict-expense")
def predict_expense():
    conn = get_db()
    rows = conn.execute(
        "SELECT date, amount FROM transactions WHERE type='expense' ORDER BY date"
    ).fetchall()
    conn.close()

    if len(rows) < 2:
        return {"prediction": "Not enough data"}

    X = np.array(range(len(rows))).reshape(-1, 1)
    y = np.array([r["amount"] for r in rows])

    model = LinearRegression()
    model.fit(X, y)

    next_val = model.predict([[len(rows)]])[0]

    return {"predicted_expense": round(float(next_val), 2)}


@router.post("/ai/advice")
def ai_advice(query: AIQuery, request: Request):
    check_rate_limit(request.client.host)
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
Income: {income}
Expenses: {expenses}
Savings Rate: {savings}%

User Question: {query.question}
"""

        max_tokens = 300 if detailed else 180

        return {"advice": ask_ai(system_prompt, user_prompt, max_tokens)}
