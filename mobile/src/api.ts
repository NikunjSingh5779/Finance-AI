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
  RecurringItem,
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
    const body = await response.json() as Record<string, unknown>;
    const detail = body.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return "Invalid input";
      }).join("; ");
    }
    if (detail && typeof detail === "object") {
      const value = detail as Record<string, unknown>;
      return String(value.message || value.msg || value.error || "The request could not be completed.");
    }
    return String(body.message || body.error_description || body.msg || "Request failed with HTTP " + response.status);
  } catch {
    return "Request failed with HTTP " + response.status;
  }
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string; user_metadata?: { name?: string; full_name?: string } };
}

export interface AIConversation {
  id: number;
  title: string;
  summary?: string | null;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
}

export interface AIMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export class FinanceApi {
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;
  private refreshPromise: Promise<AuthSession | null> | null = null;
  private sessionChangeHandler: ((session: AuthSession | null) => Promise<void> | void) | null = null;

  constructor(private readonly baseUrl: string) {}

  setSessionChangeHandler(handler: ((session: AuthSession | null) => Promise<void> | void) | null) {
    this.sessionChangeHandler = handler;
  }

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
      (!path.startsWith("/auth/") || path === "/auth/me")
    ) {
      const refreshed = await this.refreshSession();
      if (refreshed) return this.request<T>(path, init, false);
      await this.sessionChangeHandler?.(null);
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

  signupNative(email: string, password: string, name?: string) {
    return this.request<AuthSession & { requires_email_confirmation?: boolean }>(
      "/auth/signup/native",
      {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
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
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.refreshTokenValue) return null;

    const tokenToRefresh = this.refreshTokenValue;
    this.refreshPromise = (async () => {
      let response: Response;
      try {
        response = await fetch(this.url("/auth/refresh"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: tokenToRefresh }),
        });
      } catch {
        throw new ApiError("FinanceAI is temporarily unreachable. Your session has been kept on this device.");
      }

      if (response.status === 400 || response.status === 401) {
        this.clearSession();
        await this.sessionChangeHandler?.(null);
        return null;
      }
      if (!response.ok) {
        throw new ApiError(await parseError(response), response.status);
      }

      const session = (await response.json()) as AuthSession;
      if (!session.access_token || !session.refresh_token) {
        throw new ApiError("The session refresh response was incomplete.", response.status);
      }
      this.setSession(session);
      await this.sessionChangeHandler?.(session);
      return session;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  logout() {
    return this.request<{ success: boolean }>(
      "/auth/logout",
      { method: "POST" },
      false,
    );
  }

  googleNativeStart(codeChallenge: string) {
    return this.request<{ url: string }>("/auth/google/native/start", {
      method: "POST",
      body: JSON.stringify({ code_challenge: codeChallenge }),
    }, false);
  }

  googleExchange(authCode: string, codeVerifier: string) {
    return this.request<AuthSession>("/auth/google/exchange", {
      method: "POST",
      body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
    }, false);
  }

  passwordRecovery(email: string) {
    return this.request<{ success: boolean; message: string }>(
      "/auth/password/recovery",
      { method: "POST", body: JSON.stringify({ email }) },
      false,
    );
  }

  verifyEmail(tokenHash: string, type: "signup" | "email" | "recovery") {
    return this.request<AuthSession>(
      "/auth/email/verify",
      { method: "POST", body: JSON.stringify({ token_hash: tokenHash, type }) },
      false,
    );
  }

  updatePassword(password: string) {
    return this.request<{ success: boolean }>(
      "/auth/password/update",
      { method: "POST", body: JSON.stringify({ password }) },
      false,
    );
  }

  conversations() {
    return this.request<{ items: AIConversation[] }>("/api/conversations");
  }

  createConversation(title = "New chat") {
    return this.request<{ conversation: AIConversation }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  }

  getConversation(id: number) {
    return this.request<{ conversation: AIConversation; messages: AIMessage[] }>(
      "/api/conversations/" + id,
    );
  }

  renameConversation(id: number, title: string) {
    return this.request<{ conversation: AIConversation }>(
      "/api/conversations/" + id,
      { method: "PATCH", body: JSON.stringify({ title }) },
    );
  }

  deleteConversation(id: number) {
    return this.request<{ deleted: boolean }>(
      "/api/conversations/" + id,
      { method: "DELETE" },
    );
  }

  sendConversationMessage(id: number, question: string) {
    return this.request<{ success: boolean; reply: string; message: AIMessage; conversation: AIConversation }>(
      "/api/conversations/" + id + "/messages",
      { method: "POST", body: JSON.stringify({ question }) },
    );
  }

  me() {
    return this.request<{ id: string }>("/auth/me");
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

  recurring() {
    return this.request<RecurringItem[]>("/recurring");
  }

  createRecurring(payload: {
    name: string;
    amount: number;
    type: "income" | "expense";
    category: string;
    frequency: "weekly" | "monthly" | "yearly";
    next_due_date: string;
    account_id?: number | null;
  }) {
    return this.request<RecurringItem>("/recurring", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateRecurring(id: number, payload: Partial<{
    name: string;
    amount: number;
    type: "income" | "expense";
    category: string;
    frequency: "weekly" | "monthly" | "yearly";
    next_due_date: string;
    account_id: number | null;
    is_active: boolean;
  }>) {
    return this.request<RecurringItem>("/recurring/" + id, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  recordRecurring(id: number, dueDate: string) {
    return this.request<{ item: RecurringItem; transaction: Transaction }>(
      "/recurring/" + id + "/record",
      { method: "POST", body: JSON.stringify({ due_date: dueDate }) },
    );
  }

  deleteRecurring(id: number) {
    return this.request<{ deleted: number }>("/recurring/" + id, {
      method: "DELETE",
    });
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
