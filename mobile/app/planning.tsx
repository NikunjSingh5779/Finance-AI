import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFinance } from "../src/AppContext";
import {
  Button,
  Card,
  ChipRow,
  EmptyState,
  ErrorBanner,
  Header,
  Input,
  LoadingState,
  ProgressBar,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import type { Goal, NetWorthPoint, NetWorthSnapshot } from "../src/types";
import { colors } from "../src/theme";

function formatMoney(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

export default function PlanningScreen() {
  const { api, ready } = useFinance();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthSnapshot | null>(null);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [goalForm, setGoalForm] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalCurrent, setGoalCurrent] = useState("0");
  const [goalDate, setGoalDate] = useState("");
  const [goalCategory, setGoalCategory] = useState("Savings");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setError("");
      const [goalItems, net, historyResult] = await Promise.all([
        api.goals(),
        api.netWorth(),
        api.netWorthHistory(12),
      ]);
      setGoals(goalItems);
      setNetWorth(net);
      setHistory(historyResult.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load planning data.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const yearChange = useMemo(() => {
    if (history.length < 2) return null;
    const first = history[0].net_worth;
    const current = history[history.length - 1].net_worth;
    return first !== 0 ? ((current - first) / Math.abs(first)) * 100 : null;
  }, [history]);

  const createGoal = async () => {
    const target = Number(goalTarget);
    const current = Number(goalCurrent || 0);
    if (!goalName.trim() || !Number.isFinite(target) || target <= 0 || current < 0 || current > target) {
      setError("Enter a valid goal name, target and current amount.");
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create goal.");
    } finally {
      setSaving(false);
    }
  };

  const deleteGoal = (goal: Goal) => {
    Alert.alert("Delete goal", `Delete “${goal.name}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteGoal(goal.id);
            setGoals((items) => items.filter((item) => item.id !== goal.id));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete goal.");
          }
        },
      },
    ]);
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />
      }
    >
      <Header title="Planning & Wealth" />
      {error ? <ErrorBanner message={error} /> : null}

      <Card style={styles.netWorthCard}>
        <View style={styles.netWorthHeader}>
          <View>
            <SmallText>TOTAL NET WORTH</SmallText>
            <Text style={styles.netWorthValue}>{formatMoney(netWorth?.net_worth ?? 0)}</Text>
            <Text style={styles.netWorthChange}>
              {yearChange === null ? "—" : `${yearChange >= 0 ? "+" : ""}${yearChange.toFixed(1)}%`} <Text style={styles.muted}>this year</Text>
            </Text>
          </View>
          <View style={styles.chartIcon}><Text style={styles.chartIconText}>⌁</Text></View>
        </View>

        <View style={styles.netWorthBars}>
          {history.slice(-7).map((point, index, array) => {
            const max = Math.max(...array.map((item) => Math.abs(item.net_worth)), 1);
            return (
              <View key={point.month} style={styles.netWorthBarWrap}>
                <View
                  style={[
                    styles.netWorthBar,
                    {
                      height: Math.max(10, (Math.abs(point.net_worth) / max) * 72),
                      backgroundColor: index >= array.length - 2 ? colors.primary : colors.surfaceRaised,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <SectionTitle>Financial Goals</SectionTitle>
        <Pressable onPress={() => setGoalForm((value) => !value)} style={styles.plusButtonWrap}>
          <Text style={styles.plusButton}>{goalForm ? "×" : "+"}</Text>
        </Pressable>
      </View>

      {goalForm ? (
        <Card>
          <SectionTitle>New goal</SectionTitle>
          <Input label="Goal name" value={goalName} onChangeText={setGoalName} placeholder="Emergency Fund" />
          <Input label="Target amount (₹)" value={goalTarget} onChangeText={setGoalTarget} keyboardType="decimal-pad" placeholder="100000" />
          <Input label="Current amount (₹)" value={goalCurrent} onChangeText={setGoalCurrent} keyboardType="decimal-pad" placeholder="25000" />
          <Input label="Target date" value={goalDate} onChangeText={setGoalDate} placeholder="2027-12-31" />
          <SmallText>Category</SmallText>
          <ChipRow values={["Savings", "Travel", "Home", "Investing"]} selected={goalCategory} onSelect={setGoalCategory} />
          <Button title="Create goal" onPress={() => void createGoal()} loading={saving} />
        </Card>
      ) : null}

      {!goals.length ? (
        <Card><EmptyState message="No financial goals yet." /></Card>
      ) : (
        goals.map((goal) => (
          <Card key={goal.id} style={styles.goalCard}>
            <View style={styles.goalTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.goalName}>{goal.name}</Text>
                <SmallText>Target: {formatMoney(goal.target_amount)}</SmallText>
              </View>
              <Text style={styles.goalPercent}>{goal.progress_percent.toFixed(0)}%</Text>
            </View>
            <ProgressBar value={goal.progress_percent} tone="primary" />
            <View style={styles.goalBottom}>
              <SmallText>{formatMoney(goal.current_amount)} saved</SmallText>
              <Pressable onPress={() => deleteGoal(goal)}><Text style={styles.deleteText}>Delete</Text></Pressable>
            </View>
          </Card>
        ))
      )}

      <SectionTitle>Wealth Report</SectionTitle>
      <View style={styles.reportGrid}>
        <Card style={styles.reportCard}>
          <SmallText>SAVINGS RATE</SmallText>
          <Text style={styles.reportValue}>—</Text>
          <SmallText>Calculated from your latest cash flow.</SmallText>
        </Card>
        <Card style={styles.reportCard}>
          <SmallText>NET-WORTH GROWTH</SmallText>
          <Text style={[styles.reportValue, { color: colors.primary }]}>
            {yearChange === null ? "—" : `${yearChange >= 0 ? "+" : ""}${yearChange.toFixed(1)}%`}
          </Text>
          <SmallText>12-month trend.</SmallText>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  netWorthCard: { minHeight: 175, gap: 10 },
  netWorthHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  netWorthValue: { color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 3 },
  netWorthChange: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 3 },
  muted: { color: colors.subtle, fontWeight: "500" },
  chartIcon: { width: 30, height: 30, borderRadius: 6, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  chartIconText: { color: colors.primary, fontSize: 16 },
  netWorthBars: { height: 82, flexDirection: "row", alignItems: "flex-end", gap: 6, paddingHorizontal: 3, paddingTop: 4 },
  netWorthBarWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  netWorthBar: { width: "80%", maxWidth: 28, borderRadius: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  plusButtonWrap: { width: 34, height: 34, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  plusButton: { color: colors.muted, fontSize: 23, lineHeight: 28 },
  goalCard: { gap: 10 },
  goalTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  goalName: { color: colors.text, fontSize: 13, fontWeight: "800" },
  goalPercent: { color: colors.text, fontSize: 13, fontWeight: "900" },
  goalBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  deleteText: { color: colors.danger, fontSize: 10, fontWeight: "800" },
  reportGrid: { flexDirection: "row", gap: 10 },
  reportCard: { flex: 1, minHeight: 120, gap: 7 },
  reportValue: { color: colors.text, fontSize: 26, fontWeight: "900" },
});
