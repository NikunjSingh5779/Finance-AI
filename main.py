from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
import os
from dotenv import load_dotenv

load_dotenv()
from sklearn.linear_model import LinearRegression
import numpy as np

app = FastAPI(title="Finance Management API")

app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.getenv("DB_PATH", "finance.db")
import requests

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

def ask_ai(prompt: str, max_tokens=150):
    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek/deepseek-chat",
                "messages": [
                    {"role": "system", "content": "You are a professional financial advisor. Give concise but complete answers in bullet points."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.6,
                "max_tokens": max_tokens   # ✅ correct
            },
            timeout=30
        )

        data = response.json()

        if "error" in data:
            return f"AI Error: {data['error']['message']}"

        return data["choices"][0]["message"]["content"]

    except Exception as e:
        return f"AI Error: {str(e)}"
# ── Database Setup ─────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS transactions (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            type      TEXT    NOT NULL CHECK(type IN ('income','expense')),
            amount    REAL    NOT NULL,
            desc      TEXT    NOT NULL,
            category  TEXT    NOT NULL,
            date      TEXT    NOT NULL,
            created   TEXT    DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS budgets (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            category  TEXT    UNIQUE NOT NULL,
            limit_amt REAL    NOT NULL
        );
    """)
    conn.commit()
    conn.close()


init_db()


# ── Pydantic Models ────────────────────────────────────────────────────────────
class TransactionIn(BaseModel):
    type: str
    amount: float
    desc: str
    category: str
    date: str


class BudgetIn(BaseModel):
    category: str
    limit_amt: float


class AIQuery(BaseModel):
    question: str
    transactions: list = []
    summary: dict = {}
    budgets: list = []


# ── Transactions ───────────────────────────────────────────────────────────────
@app.get("/transactions")
def list_transactions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/transactions", status_code=201)
def add_transaction(txn: TransactionIn):
    if txn.type not in ("income", "expense"):
        raise HTTPException(400, "type must be 'income' or 'expense'")
    if txn.amount <= 0:
        raise HTTPException(400, "amount must be positive")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO transactions (type,amount,desc,category,date) VALUES (?,?,?,?,?)",
        (txn.type, txn.amount, txn.desc, txn.category, txn.date),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM transactions WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: int):
    conn = get_db()
    affected = conn.execute("DELETE FROM transactions WHERE id=?", (txn_id,)).rowcount
    conn.commit()
    conn.close()
    if not affected:
        raise HTTPException(404, "Not found")
    return {"deleted": txn_id}

@app.get("/predict-expense")
def predict_expense():
    conn = get_db()
    rows = conn.execute(
        "SELECT date, amount FROM transactions WHERE type='expense' ORDER BY date"
    ).fetchall()
    conn.close()

    if len(rows) < 2:
        return {"prediction": "Not enough data"}

    X = np.array(range(len(rows))).reshape(-1,1)
    y = np.array([r["amount"] for r in rows])

    model = LinearRegression()
    model.fit(X, y)

    next_val = model.predict([[len(rows)]])[0]

    return {"predicted_expense": round(float(next_val),2)}

# ── Summary ────────────────────────────────────────────────────────────────────
@app.get("/summary")
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


# ── Budgets ────────────────────────────────────────────────────────────────────
@app.get("/budgets")
def list_budgets():
    conn = get_db()
    rows = conn.execute("SELECT * FROM budgets ORDER BY category").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/budgets", status_code=201)
def set_budget(b: BudgetIn):
    conn = get_db()
    conn.execute(
        """INSERT INTO budgets (category, limit_amt) VALUES (?,?)
           ON CONFLICT(category) DO UPDATE SET limit_amt=excluded.limit_amt""",
        (b.category, b.limit_amt),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM budgets WHERE category=?", (b.category,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/budgets/{category}")
def delete_budget(category: str):
    conn = get_db()
    affected = conn.execute("DELETE FROM budgets WHERE category=?", (category,)).rowcount
    conn.commit()
    conn.close()
    if not affected:
        raise HTTPException(404, "Not found")
    return {"deleted": category}


# ── AI Advisor ─────────────────────────────────────────────
@app.post("/ai/advice")
def ai_advice(query: AIQuery):
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

    # ───── SAVINGS ─────
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

    # ───── SPENDING ─────
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

    # ───── BUDGET ─────
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

    # ───── DEFAULT AI ─────
    else:
        detailed = "explain" in q or "detailed" in q

        prompt = f"""
You are a professional financial advisor.

Give a COMPLETE but CONCISE answer.

Rules:
- Use bullet points
- Max 6–8 lines
- Focus on actionable advice

Income: {income}
Expenses: {expenses}
Savings Rate: {savings}%

User Question: {query.question}
"""

        max_tokens = 300 if detailed else 180

        return {"advice": ask_ai(prompt, max_tokens)}

# ── Serve Frontend ──────────────────────────────────────────────────────────────
@app.get("/")
def serve_index():
    from fastapi.responses import FileResponse
    return FileResponse("index.html")

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}

