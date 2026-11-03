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

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { id?: string; email?: string; user_metadata?: { name?: string } };
}

export class FinanceApi {
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setSession(session: AuthSession | null) {
    this.accessToken = session?.access_token ?? null;
    this.refreshTokenValue = session?.refresh_token ?? null;
  }

  clearSession() {
    this.accessToken = null;
    this.refreshTokenValue = null;
  }

  private url(path: string): string {
    return this.baseUrl.replace(/\/+$/, "") + path;
  }

  private async rawRequest(path: string, init?: RequestInit): Promise<Response> {
    return fetch(this.url(path), {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers || {}),
        ...(this.accessToken
          ? { Authorization: "Bearer " + this.accessToken }
          : {}),
      },
    });
  }

  async request<T>(
    path: string,
    init?: RequestInit,
    retryOnUnauthorized = true,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.rawRequest(path, init);
    } catch {
      throw new ApiError(
        "Cannot reach FinanceAI. Check that the backend is running and the API URL is correct.",
      );
    }

    if (
      response.status === 401 &&
      retryOnUnauthorized &&
      this.refreshTokenValue &&
      !path.startsWith("/auth/")
    ) {
      const refreshed = await this.refreshSession().catch(() => false);
      if (refreshed) return this.request<T>(path, init, false);
    }

    if (!response.ok) {
      throw new ApiError(await parseError(response), response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  authConfig() {
    return this.request<{ required: boolean; configured: boolean }>(
      "/auth/config",
      undefined,
      false,
    );
  }

  login(email: string, password: string) {
    return this.request<AuthSession>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      false,
    );
  }

  signup(email: string, password: string, name?: string) {
    return this.request<AuthSession & { requires_email_confirmation?: boolean }>(
      "/auth/signup",
      {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      },
      false,
    );
  }

  async refreshSession(): Promise<AuthSession | null> {
    if (!this.refreshTokenValue) return null;
    const response = await fetch(this.url("/auth/refresh"), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: this.refreshTokenValue }),
    });
    if (!response.ok) {
      this.clearSession();
      return null;
    }
    const session = (await response.json()) as AuthSession;
    this.setSession(session);
    return session.access_token ? session : null;
  }

  logout() {
    return this.request<{ success: boolean }>(
      "/auth/logout",
      { method: "POST" },
      false,
    );
  }

  me() {
    return this.request<{ id: string }>("/auth/me");
  }

  health() {
    return this.request<{ status: string; service?: string }>("/health");
  }

  health() {
    return this.request<{ status: string; service?: string }>("/health");
  }

  summary(period = "1m") {
    return this.request<Summary>("/summary?period=" + encodeURIComponent(period));
  }

  transactions(limit = 5000) {
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

  updateTransaction(
    id: number,
    payload: Partial<{
      type: "income" | "expense";
      amount: number;
      description: string;
      category: string;
      date: string;
      account_id: number | null;
    }>,
  ) {
    return this.request<Transaction>("/transactions/" + id, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  deleteAllTransactions() {
    return this.request<{ deleted: number }>("/transactions/all", {
      method: "DELETE",
    });
  }

  importTransactions(
    transactions: Array<{
      type: "income" | "expense";
      amount: number;
      description: string;
      category: string;
      date: string;
      account_id?: number | null;
    }>,
  ) {
    return this.request<{
      created: Transaction[];
      errors: Array<{ index: number; error: string }>;
      imported: number;
      failed: number;
    }>("/transactions/import", {
      method: "POST",
      body: JSON.stringify(transactions),
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

  updateAccount(
    id: number,
    payload: Partial<{
      name: string;
      balance: number;
      type: "checking" | "savings" | "credit" | "cash" | "investment";
    }>,
  ) {
    return this.request<Account>("/accounts/" + id, {
      method: "PUT",
      body: JSON.stringify(payload),
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
