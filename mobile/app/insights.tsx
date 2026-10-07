import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useFinance } from "../src/AppContext";
import {
  Card,
  ErrorBanner,
  Header,
  LoadingState,
  Pill,
  ProgressBar,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import type { InsightsDashboard, Summary, Transaction } from "../src/types";
import { colors } from "../src/theme";

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

function SpendTrend({ transactions }: { transactions: Transaction[] }) {
  const values = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return transactions
        .filter((txn) => txn.date === key && txn.type === "expense")
        .reduce((sum, txn) => sum + txn.amount, 0);
    });
  }, [transactions]);

  const width = 310;
  const height = 145;
  const max = Math.max(...values, 1);
  const path = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / 6) * width;
    const y = height - 12 - (value / max) * (height - 30);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <View style={styles.trendChart}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {[0, 1, 2, 3].map((row) => (
          <Path key={row} d={`M0 ${18 + row * 34} L${width} ${18 + row * 34}`} stroke={colors.border} strokeWidth="1" opacity={0.55} />
        ))}
        <Path d={path} fill="none" stroke={colors.primary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={styles.dayRow}>
        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
          <Text key={day} style={styles.dayText}>{day}</Text>
        ))}
      </View>
    </View>
  );
}

export default function InsightsScreen() {
  const { api, ready } = useFinance();
  const [insights, setInsights] = useState<InsightsDashboard | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setError("");
      const [dashboard, monthly, txns] = await Promise.all([
        api.insightsDashboard(),
        api.summary("1m"),
        api.transactions(5000),
      ]);
      setInsights(dashboard);
      setSummary(monthly);
      setTransactions(txns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load insights.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(
    () => Object.entries(summary?.category_totals ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4),
    [summary],
  );

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const savingsRate = summary?.savings_rate ?? 0;
  const comparison = summary?.expense_change ?? 0;

  const summaryText =
    categories.length
      ? `You've spent ${money(expense)} this month. ${categories[0][0]} is your largest expense category at ${money(categories[0][1])}.`
      : "Add more transactions to unlock detailed spending insights.";

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
      <Header title="Financial Insights" subtitle="Understand your spending patterns and financial health." />
      {error ? <ErrorBanner message={error} /> : null}

      <Card style={styles.aiSummary}>
        <View style={styles.aiTitleRow}>
          <Text style={styles.aiSpark}>✦</Text>
          <Text style={styles.aiTitle}>AI SUMMARY</Text>
        </View>
        <Text style={styles.summaryText}>{summaryText}</Text>
        {insights?.health.actions.slice(0, 2).map((action) => (
          <Text key={action} style={styles.actionText}>• {action}</Text>
        ))}
      </Card>

      <View style={styles.sectionHeader}>
        <SectionTitle>Spend Trend</SectionTitle>
        <Pill tone="neutral">Last 7 Days</Pill>
      </View>
      <Card style={styles.trendCard}>
        <SpendTrend transactions={transactions} />
      </Card>

      <View style={styles.metricsRow}>
        <Card style={styles.metricCard}>
          <SmallText>MOM COMPARISON</SmallText>
          <Text style={styles.metricValue}>{comparison >= 0 ? "+" : ""}{comparison.toFixed(1)}%</Text>
          <Text style={styles.metricSub}>vs Previous Month</Text>
        </Card>
        <Card style={styles.metricCard}>
          <SmallText>SAVINGS RATE</SmallText>
          <Text style={styles.metricValue}>{savingsRate.toFixed(1)}%</Text>
          <Text style={styles.metricSub}>Income retained</Text>
        </Card>
      </View>

      <SectionTitle>Top Categories</SectionTitle>
      <Card>
        {categories.map(([category, amount], index) => {
          const max = categories[0]?.[1] ?? 1;
          return (
            <View key={category} style={styles.categoryRow}>
              <View style={styles.categoryHead}>
                <View style={styles.categoryNameRow}>
                  <View style={[styles.categoryDot, { backgroundColor: CHART_COLORS[index] }]} />
                  <Text style={styles.categoryName}>{category}</Text>
                </View>
                <Text style={styles.categoryAmount}>{money(amount)}</Text>
              </View>
              <View style={styles.categoryTrack}>
                <View style={[styles.categoryFill, { width: `${Math.max(5, (amount / max) * 100)}%`, backgroundColor: CHART_COLORS[index] }]} />
              </View>
            </View>
          );
        })}
        {!categories.length ? <SmallText>No expense data yet.</SmallText> : null}
      </Card>

      {insights ? (
        <Card>
          <View style={styles.sectionHeader}>
            <View>
              <SmallText>FINANCIAL HEALTH</SmallText>
              <Text style={styles.healthScore}>{insights.health.score}/100</Text>
              <Text style={styles.healthGrade}>{insights.health.grade}</Text>
            </View>
            <Pill tone={insights.health.score >= 70 ? "success" : insights.health.score >= 50 ? "warning" : "danger"}>
              {insights.health.score >= 70 ? "Healthy" : insights.health.score >= 50 ? "Fair" : "Needs attention"}
            </Pill>
          </View>
          <ProgressBar value={insights.health.score} tone={insights.health.score >= 70 ? "primary" : insights.health.score >= 50 ? "warning" : "danger"} />
          <SmallText>Income: {money(income)} · Expenses: {money(expense)}</SmallText>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  aiSummary: {
    borderColor: "rgba(34,197,94,.35)",
    backgroundColor: colors.surface,
    gap: 9,
  },
  aiTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiSpark: { color: colors.primary, fontSize: 16 },
  aiTitle: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  summaryText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  actionText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  trendCard: { minHeight: 178, gap: 0 },
  trendChart: { height: 160 },
  dayRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2 },
  dayText: { color: colors.subtle, fontSize: 8, fontWeight: "700" },
  metricsRow: { flexDirection: "row", gap: 10 },
  metricCard: { flex: 1, minHeight: 112, gap: 5 },
  metricValue: { color: colors.text, fontSize: 25, fontWeight: "900" },
  metricSub: { color: colors.subtle, fontSize: 9 },
  categoryRow: { gap: 6, paddingVertical: 7 },
  categoryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  categoryNameRow: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
  categoryDot: { width: 8, height: 8, borderRadius: 999 },
  categoryName: { color: colors.text, fontSize: 12, fontWeight: "700" },
  categoryAmount: { color: colors.text, fontSize: 11, fontWeight: "800" },
  categoryTrack: { height: 5, borderRadius: 999, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  categoryFill: { height: "100%", borderRadius: 999 },
  healthScore: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 2 },
  healthGrade: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 1 },
});
