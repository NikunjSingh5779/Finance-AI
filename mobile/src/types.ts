export type TransactionType = "income" | "expense";

export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "cash"
  | "investment";

export interface Account {
  id: number;
  name: string;
  balance: number;
  type: AccountType;
  current_balance?: number | null;
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  description: string;
  category: string;
  date: string;
  account_id?: number | null;
  created: string;
}

export interface Budget {
  id: number;
  category: string;
  limit_amt: number;
}

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date?: string | null;
  category: string;
  progress_percent: number;
  remaining_amount: number;
  monthly_required?: number | null;
  months_remaining?: number | null;
  status: string;
  created: string;
}

export interface Summary {
  period: string;
  start_date?: string | null;
  end_date?: string | null;
  income: number;
  expense: number;
  balance: number;
  savings_rate: number;
  category_totals: Record<string, number>;
  account_totals: Record<string, {
    id: number;
    type: AccountType;
    income: number;
    expense: number;
    balance: number;
  }>;
  monthly: Record<string, { income: number; expense: number }>;
  income_change?: number;
  expense_change?: number;
  balance_change?: number;
}

export interface NetWorthSnapshot {
  assets: Array<{ id: number; name: string; type: AccountType; balance: number }>;
  liabilities: Array<{ id: number; name: string; type: AccountType; balance: number }>;
  asset_total: number;
  liability_total: number;
  net_worth: number;
  methodology: string;
}

export interface NetWorthPoint {
  month: string;
  asset_total: number;
  liability_total: number;
  net_worth: number;
}

export interface HealthScore {
  score: number;
  grade: string;
  components: {
    savings: number;
    budgeting: number;
    expense_consistency: number;
    cash_buffer: number;
  };
  metrics: {
    savings_rate: number;
    cash_balance: number;
    months_of_buffer: number;
    months_analyzed: number;
  };
  strengths: string[];
  actions: string[];
  methodology: string;
}

export interface RecurringExpense {
  description: string;
  category: string;
  occurrences: number;
  average_amount: number;
  estimated_monthly_cost: number;
  median_interval_days: number;
  last_date: string;
}

export interface SpendingAnomaly {
  transaction_id: number;
  date: string;
  description: string;
  category: string;
  amount: number;
  category_average: number;
  multiple_of_average: number;
  z_score: number;
  severity: "high" | "medium";
}

export interface InsightsDashboard {
  health: HealthScore;
  recurring: RecurringExpense[];
  anomalies: SpendingAnomaly[];
  counts: { recurring: number; anomalies: number };
}

export interface Forecast {
  prediction: number;
  confidence: number;
  model_used: string;
  next_month: string;
  data_points: number;
  is_estimate: boolean;
  note: string;
  historical_data: Array<{ month: string; expense: number }>;
}

export interface MonthlyReport {
  month: string;
  start_date: string;
  end_date: string;
  income: number;
  expense: number;
  net_cash_flow: number;
  savings_rate: number;
  previous_month: {
    income: number;
    expense: number;
    net_cash_flow: number;
  };
  top_categories: Array<{ category: string; amount: number }>;
  budgets: Array<{
    category: string;
    limit: number;
    spent: number;
    utilization_percent: number;
    status: "exceeded" | "warning" | "healthy";
  }>;
  recurring_expenses: RecurringExpense[];
  is_estimate: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
