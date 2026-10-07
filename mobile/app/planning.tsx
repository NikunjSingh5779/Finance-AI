import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Header,
  Input,
  LoadingState,
  Money,
  Pill,
  ProgressBar,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { currentMonth, useFinance } from "../src/AppContext";
import type { Budget, Goal, MonthlyReport, NetWorthPoint, NetWorthSnapshot } from "../src/types";
import { colors } from "../src/theme";

export default function PlanningScreen() {
  const { api, ready } = useFinance();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthSnapshot | null>(null);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [goalForm, setGoalForm] = useState(false);
  const [budgetForm, setBudgetForm] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalCurrent, setGoalCurrent] = useState("0");
  const [goalDate, setGoalDate] = useState("");
  const [goalCategory, setGoalCategory] = useState("Savings");
  const [budgetCategory, setBudgetCategory] = useState("");
  const [budgetLimit, setBudgetLimit] = useState("");
  const [editingGoal, setEditingGoal] = useState<number | null>(null);
  const [editCurrent, setEditCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadBase = useCallback(async () => {
    if (!ready) return;
    setError("");
    try {
      const [goalItems, budgetItems, net, historyResult] = await Promise.all([
        api.goals(),
        api.budgets(),
        api.netWorth(),
        api.netWorthHistory(12),
      ]);
      setGoals(goalItems);
      setBudgets(budgetItems);
      setNetWorth(net);
      setHistory(historyResult.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load planning data.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  const loadReport = useCallback(async () => {
    if (!ready || !/^\d{4}-\d{2}$/.test(month)) {
      setError("Report month must be YYYY-MM.");
      return;
    }
    try {
      setReport(await api.monthlyReport(month));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load monthly report.");
    }
  }, [api, month, ready]);

  useEffect(() => {
    void loadBase();
    void loadReport();
  }, [loadBase, loadReport]);

  const createGoal = async () => {
    const target = Number(goalTarget);
    const current = Number(goalCurrent || 0);
    if (!goalName.trim() || !Number.isFinite(target) || target <= 0 || !Number.isFinite(current) || current < 0 || current > target) {
      setError("Goal needs a name, a positive target, and a current amount within the target.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createGoal({
        name: goalName.trim(),
        target_amount: target,
        current_amount: current,
        target_date: goalDate.trim() || null,
        category: goalCategory.trim() || "Savings",
      });
      setGoalName("");
      setGoalTarget("");
      setGoalCurrent("0");
      setGoalDate("");
      setGoalForm(false);
      await loadBase();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create goal.");
    } finally {
      setSaving(false);
    }
  };

  const updateGoal = async (goal: Goal) => {
    const current = Number(editCurrent);
    if (!Number.isFinite(current) || current < 0 || current > goal.target_amount) {
      setError("Saved amount must be between 0 and the goal target.");
      return;
    }
    setSaving(true);
    try {
      await api.updateGoal(goal.id, { current_amount: current });
      setEditingGoal(null);
      setEditCurrent("");
      await loadBase();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update goal.");
    } finally {
      setSaving(false);
    }
  };

  const deleteGoal = async (goal: Goal) => {
    try {
      await api.deleteGoal(goal.id);
      setGoals((items) => items.filter((item) => item.id !== goal.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete goal.");
    }
  };

  const createBudget = async () => {
    const limit = Number(budgetLimit);
    if (!budgetCategory.trim() || !Number.isFinite(limit) || limit <= 0) {
      setError("Enter a budget category and a positive monthly limit.");
      return;
    }
    setSaving(true);
    try {
      await api.createBudget({ category: budgetCategory.trim(), limit_amt: limit });
      setBudgetCategory("");
      setBudgetLimit("");
      setBudgetForm(false);
      await loadBase();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create budget.");
    } finally {
      setSaving(false);
    }
  };

  const deleteBudget = async (budget: Budget) => {
    try {
      await api.deleteBudget(budget.category);
      setBudgets((items) => items.filter((item) => item.id !== budget.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete budget.");
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadBase(), loadReport()]);
    setRefreshing(false);
  };

  if (loading && !netWorth) return <Screen><LoadingState /></Screen>;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <Header title="Planning & Wealth" subtitle="Goals, budgets, net worth and monthly reports." />
      {error ? <ErrorBanner message={error} /> : null}

      {netWorth ? (
        <Card>
          <View style={styles.rowBetween}>
            <SectionTitle>Current net worth</SectionTitle>
            <Pill tone={netWorth.net_worth >= 0 ? "success" : "danger"}>
              {netWorth.net_worth >= 0 ? "Positive" : "Negative"}
            </Pill>
          </View>
          <Money value={netWorth.net_worth} size={34} />
          <View style={styles.statsRow}>
            <View style={{ flex: 1 }}>
              <SmallText>Assets</SmallText>
              <Money value={netWorth.asset_total} size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <SmallText>Liabilities</SmallText>
              <Money value={-netWorth.liability_total} size={18} />
            </View>
          </View>
        </Card>
      ) : null}

      <View style={styles.rowBetween}>
        <SectionTitle>Financial goals</SectionTitle>
        <Button title={goalForm ? "Close" : "+ Goal"} onPress={() => setGoalForm((v) => !v)} kind={goalForm ? "secondary" : "primary"} />
      </View>

      {goalForm ? (
        <Card>
          <Input label="Goal name" value={goalName} onChangeText={setGoalName} placeholder="Emergency fund" />
          <Input label="Target amount (₹)" keyboardType="decimal-pad" value={goalTarget} onChangeText={setGoalTarget} placeholder="100000" />
          <Input label="Saved so far (₹)" keyboardType="decimal-pad" value={goalCurrent} onChangeText={setGoalCurrent} placeholder="0" />
          <Input label="Target date (optional, YYYY-MM-DD)" value={goalDate} onChangeText={setGoalDate} placeholder="2027-10-01" />
          <Input label="Category" value={goalCategory} onChangeText={setGoalCategory} placeholder="Savings" />
          <Button title="Create goal" onPress={() => void createGoal()} loading={saving} />
        </Card>
      ) : null}

      {goals.length === 0 ? (
        <Card><EmptyState message="No financial goals yet." /></Card>
      ) : (
        goals.map((goal) => (
          <Card key={goal.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{goal.name}</Text>
                <SmallText>{goal.category}{goal.target_date ? " · target " + goal.target_date : ""}</SmallText>
              </View>
              <Pill tone={goal.status === "completed" ? "success" : goal.status === "overdue" ? "danger" : "info"}>
                {goal.status}
              </Pill>
            </View>
            <View style={styles.rowBetween}>
              <Money value={goal.current_amount} size={22} />
              <SmallText>of ₹{goal.target_amount.toLocaleString("en-IN")}</SmallText>
            </View>
            <ProgressBar value={goal.progress_percent} />
            <SmallText>
              {goal.remaining_amount > 0 ? "₹" + goal.remaining_amount.toLocaleString("en-IN") + " remaining" : "Target reached"}
              {goal.monthly_required ? " · ₹" + goal.monthly_required.toLocaleString("en-IN") + "/month" : ""}
            </SmallText>

            {editingGoal === goal.id ? (
              <View style={{ gap: 10 }}>
                <Input label="Update saved amount (₹)" keyboardType="decimal-pad" value={editCurrent} onChangeText={setEditCurrent} />
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1 }}>
                    <Button title="Save" onPress={() => void updateGoal(goal)} loading={saving} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Cancel" onPress={() => setEditingGoal(null)} kind="secondary" />
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.buttonRow}>
                <View style={{ flex: 1 }}>
                  <Button title="Update saved" onPress={() => { setEditingGoal(goal.id); setEditCurrent(String(goal.current_amount)); }} kind="secondary" />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Delete" onPress={() => deleteGoal(goal)} kind="danger" />
                </View>
              </View>
            )}
          </Card>
        ))
      )}

      <View style={styles.rowBetween}>
        <SectionTitle>Monthly budgets</SectionTitle>
        <Button title={budgetForm ? "Close" : "+ Budget"} onPress={() => setBudgetForm((v) => !v)} kind={budgetForm ? "secondary" : "primary"} />
      </View>

      {budgetForm ? (
        <Card>
          <Input label="Category" value={budgetCategory} onChangeText={setBudgetCategory} placeholder="Food" />
          <Input label="Monthly limit (₹)" keyboardType="decimal-pad" value={budgetLimit} onChangeText={setBudgetLimit} placeholder="5000" />
          <Button title="Set budget" onPress={() => void createBudget()} loading={saving} />
        </Card>
      ) : null}

      {budgets.length === 0 ? (
        <Card><EmptyState message="No budgets yet." /></Card>
      ) : (
        budgets.map((budget) => (
          <Card key={budget.id}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.cardTitle}>{budget.category}</Text>
                <SmallText>Monthly limit</SmallText>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Money value={budget.limit_amt} size={18} />
                <Pressable onPress={() => deleteBudget(budget)}>
                  <Text style={styles.dangerLink}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </Card>
        ))
      )}

      <SectionTitle>12-month net worth</SectionTitle>
      <Card>
        {history.length === 0 ? (
          <SmallText>No history available.</SmallText>
        ) : (
          history.map((point) => {
            const maximum = Math.max(...history.map((item) => Math.abs(item.net_worth)), 1);
            return (
              <View key={point.month} style={{ gap: 6 }}>
                <View style={styles.rowBetween}>
                  <SmallText>{point.month}</SmallText>
                  <Money value={point.net_worth} size={13} />
                </View>
                <ProgressBar
                  value={Math.abs(point.net_worth)}
                  max={maximum}
                  tone={point.net_worth >= 0 ? "primary" : "danger"}
                />
              </View>
            );
          })
        )}
      </Card>

      <View style={styles.rowBetween}>
        <SectionTitle>Monthly report</SectionTitle>
        <SmallText>YYYY-MM</SmallText>
      </View>

      <Card>
        <Input label="Report month" value={month} onChangeText={setMonth} placeholder="2026-10" />
        <Button title="Load report" onPress={() => void loadReport()} />
        {report ? (
          <>
            <View style={styles.statsRow}>
              <View style={{ flex: 1 }}><SmallText>Income</SmallText><Money value={report.income} size={18} /></View>
              <View style={{ flex: 1 }}><SmallText>Expenses</SmallText><Money value={-report.expense} size={18} /></View>
              <View style={{ flex: 1 }}><SmallText>Net</SmallText><Money value={report.net_cash_flow} size={18} /></View>
            </View>
            <SmallText>Savings rate: {report.savings_rate.toFixed(1)}%</SmallText>

            <SectionTitle>Top categories</SectionTitle>
            {report.top_categories.length ? report.top_categories.map((item) => (
              <View key={item.category} style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{item.category}</Text>
                <Money value={item.amount} size={14} />
              </View>
            )) : <SmallText>No spending recorded.</SmallText>}

            <SectionTitle>Budget health</SectionTitle>
            {report.budgets.length ? report.budgets.map((item) => (
              <View key={item.category} style={{ gap: 5 }}>
                <View style={styles.rowBetween}>
                  <SmallText>{item.category}</SmallText>
                  <Pill tone={item.status === "exceeded" ? "danger" : item.status === "warning" ? "warning" : "success"}>
                    {item.utilization_percent.toFixed(0)}%
                  </Pill>
                </View>
                <ProgressBar
                  value={item.utilization_percent}
                  tone={item.status === "exceeded" ? "danger" : item.status === "warning" ? "warning" : "primary"}
                />
              </View>
            )) : <SmallText>No budgets configured.</SmallText>}
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  statsRow: {
    flexDirection: "row",
    gap: 14,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  dangerLink: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
});
