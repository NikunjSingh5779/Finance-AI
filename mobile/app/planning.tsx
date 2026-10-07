import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFinance } from "../src/AppContext";
import { Button, Card, ChipRow, EmptyState, ErrorBanner, Header, Input, LoadingState, Pill, ProgressBar, Screen, SectionTitle, SmallText } from "../src/components";
import type { Goal, NetWorthPoint, NetWorthSnapshot } from "../src/types";
import { colors } from "../src/theme";

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

const goalColors = [colors.warning, colors.info, "#a855f7", colors.primary];

export default function PlanningScreen() {
  const { api, ready } = useFinance();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [net, setNet] = useState<NetWorthSnapshot | null>(null);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("0");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("Savings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setError("");
      const [goalItems, netWorth, historyResult] = await Promise.all([
        api.goals(),
        api.netWorth(),
        api.netWorthHistory(12),
      ]);
      setGoals(goalItems);
      setNet(netWorth);
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
    const last = history[history.length - 1].net_worth;
    return first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
  }, [history]);

  const createGoal = async () => {
    const targetAmount = Number(target);
    const currentAmount = Number(current || 0);
    if (!name.trim() || !Number.isFinite(targetAmount) || targetAmount <= 0 || !Number.isFinite(currentAmount) || currentAmount < 0 || currentAmount > targetAmount) {
      setError("Enter a valid goal name, target and current amount.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.createGoal({ name: name.trim(), target_amount: targetAmount, current_amount: currentAmount, target_date: date.trim() || null, category });
      setName("");
      setTarget("");
      setCurrent("0");
      setDate("");
      setCategory("Savings");
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create goal.");
    } finally {
      setSaving(false);
    }
  };

  const deleteGoal = (goal: Goal) => {
    Alert.alert("Delete goal", "Delete “" + goal.name + "”? ", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
          try {
            await api.deleteGoal(goal.id);
            setGoals((items) => items.filter((item) => item.id !== goal.id));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete goal.");
          }
        } },
    ]);
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  const chart = history.slice(-7);
  const max = Math.max(...chart.map((item) => Math.abs(item.net_worth)), 1);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
      <Header title="Planning & Wealth" action="plus" onAction={() => setFormOpen((v) => !v)} />
      {error ? <ErrorBanner message={error} /> : null}

      <Card style={styles.netWorthCard}>
        <View style={styles.netWorthTop}>
          <View style={{ flex: 1 }}>
            <SmallText>TOTAL NET WORTH</SmallText>
            <Text style={styles.netWorthValue}>{money(net?.net_worth ?? 0)}</Text>
            <Text style={styles.changeText}>{yearChange === null ? "—" : (yearChange >= 0 ? "+" : "") + yearChange.toFixed(1) + "%"}<Text style={styles.muted}> this year</Text></Text>
          </View>
          <View style={styles.chartAction}><Text style={styles.chartActionText}>⌁</Text></View>
        </View>
        <View style={styles.barChart}>
          {chart.map((item, index) => (
            <View key={item.month} style={styles.barSlot}>
              <View style={[styles.bar, { height: Math.max(10, (Math.abs(item.net_worth) / max) * 68), backgroundColor: index >= chart.length - 2 ? colors.primary : colors.surfaceRaised }]} />
            </View>
          ))}
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <SectionTitle>Financial Goals</SectionTitle>
        <Pressable onPress={() => undefined} style={styles.viewAllButton}>
          <Text style={styles.viewAllText}>View All</Text>
        </Pressable>
      </View>
      <SmallText>{goals.length} active goal{goals.length === 1 ? "" : "s"}</SmallText>

      {formOpen ? (
        <Card>
          <SectionTitle>New goal</SectionTitle>
          <Input label="Goal name" value={name} onChangeText={setName} placeholder="Emergency Fund" />
          <Input label="Target amount (₹)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="100000" />
          <Input label="Current amount (₹)" value={current} onChangeText={setCurrent} keyboardType="decimal-pad" placeholder="25000" />
          <Input label="Target date" value={date} onChangeText={setDate} placeholder="2027-12-31" />
          <SmallText>Category</SmallText>
          <ChipRow values={["Savings", "Travel", "Home", "Investing"]} selected={category} onSelect={setCategory} />
          <Button title="Create goal" onPress={() => void createGoal()} loading={saving} />
        </Card>
      ) : null}

      {!goals.length ? (
        <Card><EmptyState message="No financial goals yet." /></Card>
      ) : (
        goals.map((goal, index) => (
          <Card key={goal.id} style={styles.goalCard}>
            <View style={styles.goalTop}>
              <View style={[styles.goalIcon, { backgroundColor: goalColors[index % goalColors.length] + "22" }]}><Text style={{ color: goalColors[index % goalColors.length], fontSize: 14 }}>{goal.category.toLowerCase().includes("travel") ? "✈" : goal.category.toLowerCase().includes("home") ? "⌂" : "◎"}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.goalName}>{goal.name}</Text><SmallText>Target: {money(goal.target_amount)}</SmallText></View>
              <Text style={styles.goalPercent}>{goal.progress_percent.toFixed(0)}%</Text>
            </View>
            <ProgressBar value={goal.progress_percent} tone="primary" />
            <View style={styles.goalBottom}><SmallText>{money(goal.current_amount)} saved</SmallText><SmallText>{goal.target_date || goal.status}</SmallText><Pressable onPress={() => deleteGoal(goal)}><Text style={styles.deleteText}>Delete</Text></Pressable></View>
          </Card>
        ))
      )}

      <SectionTitle>Wealth Report</SectionTitle>
      <View style={styles.reportGrid}>
        <Card style={styles.reportCard}><SmallText>SAVINGS RATE</SmallText><Text style={styles.reportValue}>—</Text><SmallText>Based on current cash flow.</SmallText></Card>
        <Card style={styles.reportCard}><SmallText>NET-WORTH GROWTH</SmallText><Text style={[styles.reportValue, { color: colors.primary }]}>{yearChange === null ? "—" : (yearChange >= 0 ? "+" : "") + yearChange.toFixed(1) + "%"}</Text><SmallText>12-month trend.</SmallText></Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  netWorthCard: { minHeight: 180, gap: 11 },
  netWorthTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  netWorthValue: { color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 3 },
  changeText: { color: colors.primary, fontSize: 10, fontWeight: "800", marginTop: 3 },
  muted: { color: colors.subtle, fontWeight: "500" },
  chartAction: { width: 30, height: 30, borderRadius: 7, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  chartActionText: { color: colors.primary, fontSize: 15 },
  barChart: { height: 78, flexDirection: "row", alignItems: "flex-end", gap: 7, paddingHorizontal: 3 },
  barSlot: { flex: 1, height: 74, justifyContent: "flex-end", alignItems: "center" },
  bar: { width: "72%", borderRadius: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewAllButton: { paddingHorizontal: 2, paddingVertical: 4 },
  viewAllText: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  goalCard: { gap: 10 },
  goalTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  goalIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  goalName: { color: colors.text, fontSize: 13, fontWeight: "800" },
  goalPercent: { color: colors.text, fontSize: 13, fontWeight: "900" },
  goalBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  deleteText: { color: colors.danger, fontSize: 10, fontWeight: "800" },
  reportGrid: { flexDirection: "row", gap: 10 },
  reportCard: { flex: 1, minHeight: 115, gap: 6 },
  reportValue: { color: colors.text, fontSize: 25, fontWeight: "900" },
});
