import type {
  Account,
  Budget,
  Forecast,
  Goal,
  HealthScore,
  InsightsDashboard,
  MonthlyReport,
  NetWorthPoint,
  NetWorthSnapshot,
  Summary,
  Transaction,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || "Request failed with HTTP " + response.status;
  } catch {
    return "Request failed with HTTP " + response.status;
  }
}

export class FinanceApi {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return this.baseUrl.replace(/\/+$/, "") + path;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    } catch {
      throw new ApiError(
        "Cannot reach FinanceAI. Check that the backend is running and the API URL is correct.",
      );
    }

    if (!response.ok) {
      throw new ApiError(await parseError(response), response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  health() {
    return this.request<{ status: string; service?: string }>("/health");
  }

  summary(period = "1m") {
    return this.request<Summary>("/summary?period=" + encodeURIComponent(period));
  }

  transactions(limit = 500) {
    return this.request<Transaction[]>("/transactions?skip=0&limit=" + limit);
  }

  createTransaction(payload: {
    type: "income" | "expense";
    amount: number;
    description: string;
    category: string;
    date: string;
    account_id?: number | null;
  }) {
    return this.request<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  deleteTransaction(id: number) {
    return this.request<{ deleted: number }>("/transactions/" + id, {
      method: "DELETE",
    });
  }

  accounts() {
    return this.request<Account[]>("/accounts");
  }

  createAccount(payload: {
    name: string;
    balance: number;
    type: "checking" | "savings" | "credit" | "cash" | "investment";
  }) {
    return this.request<Account>("/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  deleteAccount(id: number) {
    return this.request<{ deleted: number }>("/accounts/" + id, {
      method: "DELETE",
    });
  }


  budgets() {
    return this.request<Budget[]>("/budgets");
  }

  createBudget(payload: { category: string; limit_amt: number }) {
    return this.request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  deleteBudget(category: string) {
    return this.request<{ deleted: string }>(
      "/budgets/" + encodeURIComponent(category),
      { method: "DELETE" },
    );
  }

  goals() {
    return this.request<Goal[]>("/goals");
  }

  createGoal(payload: {
    name: string;
    target_amount: number;
    current_amount: number;
    target_date?: string | null;
    category: string;
  }) {
    return this.request<Goal>("/goals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateGoal(
    id: number,
    payload: Partial<{
      name: string;
      target_amount: number;
      current_amount: number;
      target_date: string | null;
      category: string;
    }>,
  ) {
    return this.request<Goal>("/goals/" + id, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  deleteGoal(id: number) {
    return this.request<{ deleted: number }>("/goals/" + id, {
      method: "DELETE",
    });
  }

  netWorth() {
    return this.request<NetWorthSnapshot>("/api/net-worth");
  }

  netWorthHistory(months = 12) {
    return this.request<{ months: number; history: NetWorthPoint[] }>(
      "/api/net-worth/history?months=" + months,
    );
  }

  monthlyReport(month: string) {
    return this.request<MonthlyReport>(
      "/api/reports/monthly?month=" + encodeURIComponent(month),
    );
  }

  healthScore() {
    return this.request<HealthScore>("/api/insights/health");
  }

  insightsDashboard() {
    return this.request<InsightsDashboard>("/api/insights/dashboard");
  }

  forecast() {
    return this.request<Forecast>("/predict-expense");
  }

  aiProviders() {
    return this.request<Record<string, unknown>>("/ai/providers");
  }

  chat(question: string, messages: Array<{ role: string; content: string }>) {
    return this.request<{ reply: string; success: boolean }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question, messages }),
    });
  }
}
