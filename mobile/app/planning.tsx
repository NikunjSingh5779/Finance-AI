import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFinance } from "../src/AppContext";
import { Button, Card, ChipRow, EmptyState, ErrorBanner, Header, Input, LoadingState, Pill, Screen, SectionTitle, SmallText } from "../src/components";
import { Icon } from "../src/icons";
import type { Goal, MonthlyReport, NetWorthPoint, NetWorthSnapshot } from "../src/types";
import { colors } from "../src/theme";

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function monthKey() {
  return new Date().toISOString().slice(0, 7);
}
const goalColors = [colors.warning, colors.info, colors.chartPurple, colors.primary];

export default function PlanningScreen() {
  const { api, ready } = useFinance();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [net, setNet] = useState<NetWorthSnapshot | null>(null);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [hiddenNetWorth, setHiddenNetWorth] = useState(false);
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
      const [goalItems, netWorth, historyResult, monthlyReport] = await Promise.all([
        api.goals(),
        api.netWorth(),
        api.netWorthHistory(12),
        api.monthlyReport(monthKey()),
      ]);
      setGoals(goalItems);
      setNet(netWorth);
      setHistory(historyResult.history);
      setReport(monthlyReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load planning data.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const yearChange = useMemo(() => {
    if (history.length < 2) return null;
    const firstEntry = history[0];
    const lastEntry = history[history.length - 1];
    if (!firstEntry || !lastEntry) return null;
    const first = firstEntry.net_worth;
    const last = lastEntry.net_worth;
    return first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
  }, [history]);

  const chart = history.slice(-7);
  const chartMax = Math.max(...chart.map((item) => Math.abs(item.net_worth)), 1);

  const resetForm = () => {
    setName("");
    setTarget("");
    setCurrent("0");
    setDate("");
    setCategory("Savings");
    setFormOpen(false);
  };

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
      await api.createGoal({
        name: name.trim(),
        target_amount: targetAmount,
        current_amount: currentAmount,
        target_date: date.trim() || null,
        category,
      });
      resetForm();
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
    <>
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
        <Header title="Planning & Wealth" action="refresh" onAction={() => void load()} />
        {error ? <ErrorBanner message={error} /> : null}

        <View style={styles.pageHeader}>
          <View>
            <SmallText>WEALTH PLANNING</SmallText>
            <SectionTitle>Planning & Wealth</SectionTitle>
          </View>
          <Pressable style={styles.addButton} onPress={() => setFormOpen(true)} accessibilityRole="button" accessibilityLabel="Add financial goal">
            <Icon name="plus" size={18} color={colors.onAccent} />
            <Text style={styles.addButtonText}>Add goal</Text>
          </Pressable>
        </View>

        <Card style={styles.netWorthCard}>
          <View style={styles.netWorthTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.netWorthLabel}>Current net worth</Text>
              <SmallText>Derived from account balances</SmallText>
            </View>
            <Pressable style={styles.visibilityButton} onPress={() => setHiddenNetWorth((v) => !v)} accessibilityRole="button" accessibilityLabel="Toggle net worth visibility">
              <Icon name="eye" size={16} color={colors.muted} />
            </Pressable>
          </View>

          <View style={styles.amountRow}>
            <Text style={styles.currency}>₹</Text>
            <Text style={styles.netWorthValue}>{hiddenNetWorth ? "••••••" : Number(net?.net_worth ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</Text>
          </View>

          <Pill tone={yearChange === null ? "neutral" : yearChange >= 0 ? "success" : "danger"}>
            {yearChange === null ? "No historical trend yet" : (yearChange >= 0 ? "+" : "") + yearChange.toFixed(1) + "% this year"}
          </Pill>

          <View style={styles.divider} />
          <View style={styles.metricsRow}>
            <View style={styles.metricBlock}>
              <SmallText>ASSETS</SmallText>
              <Text style={[styles.metricValue, { color: colors.primary }]}>{money(net?.asset_total ?? 0)}</Text>
              <SmallText>{net?.assets.length ? net.assets.length + " accounts" : "Balances not available"}</SmallText>
            </View>
            <View style={styles.colDivider} />
            <View style={[styles.metricBlock, { paddingLeft: 16 }]}>
              <SmallText>LIABILITIES</SmallText>
              <Text style={styles.metricValue}>{money(net?.liability_total ?? 0)}</Text>
              <SmallText>{net?.liabilities.length ? net.liabilities.length + " accounts" : "No liabilities"}</SmallText>
            </View>
          </View>

          <View style={styles.chartHeader}>
            <SmallText>12-month net worth trend</SmallText>
            <Text style={styles.chartValue}>{yearChange === null ? "No trend" : (yearChange >= 0 ? "+" : "") + yearChange.toFixed(1) + "%"}</Text>
          </View>
          <View style={styles.barChart}>
            {chart.length ? chart.map((item, index) => (
              <View key={item.month} style={styles.barSlot}>
                <View style={[styles.bar, { height: Math.max(10, (Math.abs(item.net_worth) / chartMax) * 92), backgroundColor: index >= chart.length - 2 ? colors.primary : colors.surfaceRaised }]} />
              </View>
            )) : <SmallText>No historical trend yet.</SmallText>}
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <View>
            <SmallText>GOALS</SmallText>
            <SectionTitle>Financial Goals</SectionTitle>
          </View>
          <SmallText>{goals.length} active</SmallText>
        </View>

        <Card style={styles.goalsCard}>
          {goals.slice(0, 2).map((goal, index) => (
            <View key={goal.id} style={styles.goalRow}>
              <View style={[styles.goalIcon, { backgroundColor: goalColors[index % goalColors.length] + "22" }]}>
                <Icon name="target" size={18} color={goalColors[index % goalColors.length]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.goalName}>{goal.name}</Text>
                <SmallText>{money(goal.current_amount)} of {money(goal.target_amount)}</SmallText>
              </View>
              <View style={styles.goalRight}>
                <Text style={styles.goalPercent}>{goal.progress_percent.toFixed(0)}%</Text>
                <Pressable onPress={() => deleteGoal(goal)} accessibilityLabel={"Delete goal " + goal.name}>
                  <Icon name="trash" size={15} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          ))}
          {!goals.length ? <EmptyState message="No financial goals yet." actionLabel="Create goal" onAction={() => setFormOpen(true)} /> : null}
          {goals.length > 2 ? <Text style={styles.moreText}>{goals.length - 2} more goals · Open Planning to view all</Text> : null}
        </Card>

        <Card style={styles.reportCard}>
          <View style={styles.sectionHeader}>
            <View>
              <SmallText>WEALTH REPORT</SmallText>
              <SectionTitle>{report?.month || "Current month"}</SectionTitle>
            </View>
            <Pill tone="info">{report?.is_estimate ? "Estimate" : "Live"}</Pill>
          </View>

          <View style={styles.reportGrid}>
            <View style={styles.reportMetric}><SmallText>INCOME</SmallText><Text style={styles.reportValue}>{money(report?.income ?? 0)}</Text></View>
            <View style={styles.reportMetric}><SmallText>EXPENSES</SmallText><Text style={styles.reportValue}>{money(report?.expense ?? 0)}</Text></View>
            <View style={styles.reportMetric}><SmallText>NET FLOW</SmallText><Text style={styles.reportValue}>{money(report?.net_cash_flow ?? 0)}</Text></View>
            <View style={styles.reportMetric}><SmallText>SAVINGS RATE</SmallText><Text style={styles.reportValue}>{(report?.savings_rate ?? 0).toFixed(1)}%</Text></View>
          </View>

          {report?.previous_month ? (
            <View style={styles.previousMonth}>
              <SmallText>
                Previous month: {money(report.previous_month.income)} income · {money(report.previous_month.expense)} expenses · {money(report.previous_month.net_cash_flow)} net
              </SmallText>
            </View>
          ) : null}

          <View style={styles.divider} />
          <Text style={styles.reportHeading}>Top spending categories</Text>
          {report?.top_categories?.slice(0, 4).map((item) => (
            <View key={item.category} style={styles.topCategoryRow}>
              <Text style={styles.topCategoryName}>{item.category}</Text>
              <Text style={styles.topCategoryAmount}>{money(item.amount)}</Text>
            </View>
          ))}
          {!report?.top_categories?.length ? <SmallText>No category data available.</SmallText> : null}
        </Card>
      </Screen>

      <Modal visible={formOpen} animationType="slide" transparent={false} onRequestClose={() => !saving && setFormOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => !saving && setFormOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Create Goal</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {error ? <ErrorBanner message={error} /> : null}
            <Input label="Goal name" value={name} onChangeText={setName} placeholder="Emergency Fund" />
            <Input label="Current amount (₹)" value={current} onChangeText={setCurrent} keyboardType="decimal-pad" placeholder="25000" />
            <Input label="Target amount (₹)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="100000" />
            <Input label="Target date" value={date} onChangeText={setDate} placeholder="2027-12-31" />
            <SmallText>Category</SmallText>
            <ChipRow values={["Savings", "Travel", "Home", "Investing"]} selected={category} onSelect={setCategory} />
            <Button title="Create goal" onPress={() => void createGoal()} loading={saving} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  addButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addButtonText: { color: colors.onAccent, fontSize: 12, fontWeight: "700" },
  netWorthCard: { gap: 12, padding: 16 },
  netWorthTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  netWorthLabel: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  visibilityButton: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  currency: { color: colors.muted, fontSize: 18, fontWeight: "600" },
  netWorthValue: { color: colors.text, fontSize: 32, lineHeight: 35, fontWeight: "700" },
  divider: { height: 1, backgroundColor: colors.border },
  metricsRow: { flexDirection: "row", alignItems: "flex-start" },
  metricBlock: { flex: 1, minHeight: 64, gap: 4 },
  colDivider: { width: 1, height: 50, backgroundColor: colors.border },
  metricValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chartValue: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  barChart: { height: 100, flexDirection: "row", alignItems: "flex-end", gap: 7, paddingHorizontal: 3 },
  barSlot: { flex: 1, height: 92, justifyContent: "flex-end", alignItems: "center" },
  bar: { width: "72%", borderRadius: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  goalsCard: { gap: 0, paddingVertical: 8 },
  goalRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  goalIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  goalName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  goalRight: { alignItems: "flex-end", gap: 8 },
  goalPercent: { color: colors.text, fontSize: 13, fontWeight: "700" },
  moreText: { color: colors.muted, fontSize: 12, paddingTop: 10 },
  reportCard: { gap: 12 },
  reportGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reportMetric: { width: "48%", minHeight: 78, backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: 12, gap: 4 },
  reportValue: { color: colors.text, fontSize: 18, fontWeight: "700" },
  previousMonth: { backgroundColor: colors.surfaceRaised, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  reportHeading: { color: colors.text, fontSize: 14, fontWeight: "700" },
  topCategoryRow: { minHeight: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  topCategoryName: { color: colors.muted, fontSize: 13 },
  topCategoryAmount: { color: colors.text, fontSize: 13, fontWeight: "600" },
  modalRoot: { flex: 1, backgroundColor: colors.background },
  modalHeader: { minHeight: 108, paddingTop: 48, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  modalContent: { padding: 16, gap: 16, paddingBottom: 40 },
});
