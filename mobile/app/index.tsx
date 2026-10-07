import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import {
  Card,
  ErrorBanner,
  Header,
  LoadingState,
  Money,
  Pill,
  ProgressBar,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { useFinance } from "../src/AppContext";
import type {
  Account,
  Budget,
  Forecast,
  InsightsDashboard,
  NetWorthSnapshot,
  Summary,
  Transaction,
} from "../src/types";
import { colors } from "../src/theme";

function SparkBars({
  values,
  tone = "primary",
}: {
  values: number[];
  tone?: "primary" | "danger" | "warning";
}) {
  const color = tone === "danger" ? colors.danger : tone === "warning" ? colors.warning : colors.primary;
  const safe = values.length ? values : [0, 1];
  const max = Math.max(...safe.map((v) => Math.abs(v)), 1);
  return (
    <View style={styles.sparkWrap}>
      {safe.slice(-12).map((value, index) => (
        <View
          key={String(index)}
          style={[
            styles.sparkBar,
            {
              height: Math.max(3, (Math.abs(value) / max) * 32),
              backgroundColor: color,
            },
          ]}
        />
      ))}
    </View>
  );
}

function CashFlowBars({ monthly }: { monthly: Summary["monthly"] }) {
  const points = Object.entries(monthly || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-8);
  const max = Math.max(...points.flatMap(([, v]) => [v.income, v.expense]), 1);

  return (
    <View style={styles.chartArea}>
      <View style={styles.chartGrid}>
        {[0, 1, 2, 3].map((line) => <View key={line} style={[styles.gridLine, { top: line * 25 + "%" }]} />)}
      </View>
      <View style={styles.barChart}>
        {points.map(([month, value]) => (
          <View key={month} style={styles.barGroup}>
            <View style={styles.barPair}>
              <View style={[styles.chartBar, { height: Math.max(4, (value.income / max) * 112), backgroundColor: colors.primary }]} />
              <View style={[styles.chartBar, { height: Math.max(4, (value.expense / max) * 112), backgroundColor: colors.danger }]} />
            </View>
            <Text style={styles.chartLabel}>{month.slice(5)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { api, ready } = useFinance();
  const { width } = useWindowDimensions();
  const compact = width < 720;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [insights, setInsights] = useState<InsightsDashboard | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthSnapshot | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    setError("");
    const results = await Promise.allSettled([
      api.summary("1y"),
      api.summary("all"),
      api.transactions(5000),
      api.accounts(),
      api.budgets(),
      api.insightsDashboard(),
      api.netWorth(),
      api.forecast(),
    ]);

    const [selected, all, txn, acc, budget, insight, worth, forecastResult] = results;
    if (selected.status === "fulfilled") setSummary(selected.value);
    if (all.status === "fulfilled" && selected.status === "fulfilled") {
      setSummary({
        ...selected.value,
        balance: selected.value.balance,
        income: selected.value.income,
        expense: selected.value.expense,
      });
    }
    if (txn.status === "fulfilled") setTransactions(txn.value);
    if (acc.status === "fulfilled") setAccounts(acc.value);
    if (budget.status === "fulfilled") setBudgets(budget.value);
    if (insight.status === "fulfilled") setInsights(insight.value);
    if (worth.status === "fulfilled") setNetWorth(worth.value);
    if (forecastResult.status === "fulfilled") setForecast(forecastResult.value);

    const firstFailure = results.find((item) => item.status === "rejected");
    if (firstFailure?.status === "rejected") {
      setError(firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some dashboard data could not be loaded.");
    }
    setLoading(false);
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const balance = summary?.balance ?? 0;
  const savingsRate = summary?.savings_rate ?? 0;

  const categories = useMemo(
    () => Object.entries(summary?.category_totals ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6),
    [summary],
  );

  const cashIncome = Object.values(summary?.monthly ?? {}).map((item) => item.income);
  const cashExpense = Object.values(summary?.monthly ?? {}).map((item) => item.expense);
  const cashNet = cashIncome.map((value, index) => value - (cashExpense[index] ?? 0));

  const budgetSnapshot = budgets.slice(0, 4).map((budget) => {
    const spent = Number(summary?.category_totals?.[budget.category] ?? 0);
    const pct = budget.limit_amt > 0 ? Math.min(100, (spent / budget.limit_amt) * 100) : 0;
    return { ...budget, spent, pct };
  });

  if (loading && !summary) return <Screen><LoadingState /></Screen>;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <Header title="FinanceAI" subtitle="Your money, decisions and progress in one place." />
      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.hero}>
        <Text style={styles.greeting}>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}</Text>
        <Text style={styles.heroTitle}>Here's your money, at a glance.</Text>
        <Text style={styles.heroSubtitle}>
          Your savings rate is {savingsRate.toFixed(1)}%. {savingsRate >= 40 ? "Keep building consistent cash flow." : "Let's find opportunities to reduce spending."}
        </Text>
      </View>

      <View style={[styles.summaryGrid, compact && styles.summaryGridCompact]}>
        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Total balance</SmallText><Pill tone={balance >= 0 ? "success" : "danger"}>{balance >= 0 ? "Positive" : "Negative"}</Pill></View>
          <Money value={balance} size={28} />
          <SmallText>after all recorded income & expenses</SmallText>
          <SparkBars values={cashNet} />
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Income</SmallText><SmallText>this period</SmallText></View>
          <Money value={income} size={28} />
          <SmallText>vs. previous period</SmallText>
          <SparkBars values={cashIncome} />
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Expenses</SmallText><Pill tone={expense <= income ? "success" : "danger"}>{expense <= income ? "On track" : "High"}</Pill></View>
          <Money value={-expense} size={28} />
          <SmallText>recorded spending</SmallText>
          <SparkBars values={cashExpense} tone="danger" />
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Savings rate</SmallText><SmallText>goal: 40%</SmallText></View>
          <Text style={styles.savingsValue}>{savingsRate.toFixed(1)}%</Text>
          <ProgressBar value={savingsRate} tone={savingsRate >= 40 ? "primary" : "warning"} />
          <SmallText>{savingsRate >= 40 ? "Healthy savings pace" : "Needs attention"}</SmallText>
        </Card>
      </View>

      <Card style={styles.addCard}>
        <Text style={styles.addText}>Keep your cash flow current.</Text>
        <PressableLike title="+ Add transaction" onPress={() => router.push("/transactions")} />
      </Card>

      <View style={[styles.twoColumn, compact && styles.oneColumn]}>
        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View>
              <SmallText>Cash flow • Income vs. expenses</SmallText>
              <Text style={styles.panelValue}>{MoneyText(balance)}</Text>
              <Pill tone={balance >= 0 ? "success" : "danger"}>{balance >= 0 ? "Net positive" : "Net negative"}</Pill>
            </View>
            <View style={styles.rangeRow}>
              {["1M", "3M", "6M", "1Y", "All"].map((range, index) => (
                <View key={range} style={[styles.rangePill, index === 3 && styles.rangeActive]}><Text style={styles.rangeText}>{range}</Text></View>
              ))}
            </View>
          </View>
          <View style={styles.legendRow}>
            <Legend color={colors.primary} text={"Income " + money(income)} />
            <Legend color={colors.danger} text={"Expenses " + money(expense)} />
          </View>
          <CashFlowBars monthly={summary?.monthly ?? {}} />
        </Card>

        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View><SmallText>Spending by category</SmallText><Text style={styles.panelTitle}>All time</Text></View>
            <PressableLike title="View all" kind="link" onPress={() => router.push("/transactions")} />
          </View>
          {categories.map(([category, amount], index) => {
            const total = categories.reduce((sum, [, value]) => sum + value, 0) || 1;
            const percentage = (amount / total) * 100;
            return (
              <View key={category} style={styles.categoryRow}>
                <View style={styles.rowBetween}><Text style={styles.categoryName}>{category}</Text><Money value={amount} size={13} /></View>
                <View style={styles.categoryTrack}><View style={[styles.categoryFill, { width: percentage + "%", backgroundColor: [colors.primary, colors.warning, colors.info, colors.danger, "#a855f7", "#f97316"][index] }]} /></View>
              </View>
            );
          })}
          {!categories.length ? <SmallText>No expense categories yet.</SmallText> : null}
        </Card>
      </View>

      <View style={[styles.twoColumn, compact && styles.oneColumn]}>
        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View><SmallText>Recent transactions</SmallText><Text style={styles.panelTitle}>Latest activity</Text></View>
            <PressableLike title="View all" kind="link" onPress={() => router.push("/transactions")} />
          </View>
          {transactions.slice(0, 6).map((txn) => (
            <View key={txn.id} style={styles.transactionRow}>
              <View style={[styles.iconBox, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.dangerSoft }]}>
                <Text style={{ color: txn.type === "income" ? colors.primary : colors.danger, fontSize: 16 }}>{txn.type === "income" ? "↗" : "↘"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.transactionTitle} numberOfLines={1}>{txn.description}</Text>
                <SmallText>{txn.category} · {txn.date}</SmallText>
              </View>
              <Text style={[styles.transactionAmount, { color: txn.type === "income" ? colors.primary : colors.danger }]}>{txn.type === "income" ? "+" : "-"}₹{txn.amount.toLocaleString("en-IN")}</Text>
            </View>
          ))}
          {!transactions.length ? <SmallText>No transactions yet.</SmallText> : null}
        </Card>

        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View><SmallText>Budgets</SmallText><Text style={styles.panelTitle}>{budgets.length} active</Text></View>
            <PressableLike title="Manage" kind="link" onPress={() => router.push("/planning")} />
          </View>
          {budgetSnapshot.map((budget) => (
            <View key={budget.id} style={styles.budgetRow}>
              <View style={styles.rowBetween}>
                <Text style={styles.categoryName}>{budget.category}</Text>
                <Text style={styles.budgetAmounts}>{money(budget.spent)} / {money(budget.limit_amt)}</Text>
              </View>
              <ProgressBar value={budget.pct} tone={budget.pct >= 100 ? "danger" : budget.pct >= 80 ? "warning" : "primary"} />
            </View>
          ))}
          {!budgetSnapshot.length ? <SmallText>No budgets set.</SmallText> : null}
        </Card>
      </View>

      <View style={[styles.twoColumn, compact && styles.oneColumn]}>
        {netWorth ? (
          <Card style={styles.smallCard}>
            <SmallText>Net worth</SmallText>
            <Text style={styles.netWorth}>{money(netWorth.net_worth)}</Text>
            <View style={styles.statsRow}>
              <View><SmallText>Assets</SmallText><Text style={styles.statValue}>{money(netWorth.asset_total)}</Text></View>
              <View><SmallText>Liabilities</SmallText><Text style={styles.statValue}>{money(netWorth.liability_total)}</Text></View>
            </View>
          </Card>
        ) : null}

        {insights ? (
          <Card style={styles.smallCard}>
            <View style={styles.rowBetween}><SmallText>AI insights</SmallText><Pill tone="success">Updated</Pill></View>
            <Text style={styles.netWorth}>{insights.health.score}/100</Text>
            <Text style={styles.healthGrade}>{insights.health.grade}</Text>
            <ProgressBar value={insights.health.score} />
            <PressableLike title="View insights" kind="link" onPress={() => router.push("/insights")} />
          </Card>
        ) : null}

        {forecast ? (
          <Card style={styles.smallCard}>
            <View style={styles.rowBetween}><SmallText>Next-month expense estimate</SmallText><Pill tone="info">{forecast.confidence.toFixed(0)}%</Pill></View>
            <Text style={[styles.netWorth, { color: colors.primary }]}>{money(forecast.prediction)}</Text>
            <SmallText>{forecast.next_month} · {forecast.model_used}</SmallText>
          </Card>
        ) : null}
      </View>

      <Card>
        <View style={styles.rowBetween}>
          <View><SmallText>Accounts</SmallText><Text style={styles.panelTitle}>{accounts.length} configured</Text></View>
          <PressableLike title="Manage" kind="link" onPress={() => router.push("/settings")} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountRow}>
          {accounts.map((account) => (
            <View key={account.id} style={styles.accountCard}>
              <Text style={styles.transactionTitle}>{account.name}</Text>
              <SmallText>{account.type}</SmallText>
              <Text style={styles.statValue}>{money(account.current_balance ?? account.balance)}</Text>
            </View>
          ))}
        </ScrollView>
        {!accounts.length ? <SmallText>No accounts configured.</SmallText> : null}
      </Card>
    </Screen>
  );
}

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

function MoneyText(value: number) {
  return (value < 0 ? "-₹" : "₹") + Math.abs(value).toLocaleString("en-IN");
}

function Legend({ color, text }: { color: string; text: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{text}</Text></View>;
}

function PressableLike({
  title,
  onPress,
  kind = "primary",
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "link";
}) {
  return (
    <Text onPress={onPress} style={kind === "link" ? styles.link : styles.addButton}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 2, paddingTop: 2, gap: 4 },
  greeting: { color: colors.muted, fontSize: 13 },
  heroTitle: { color: colors.text, fontSize: 29, fontWeight: "800", letterSpacing: -0.7 },
  heroSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryGridCompact: { flexWrap: "wrap" },
  summaryCard: { flex: 1, minWidth: 0, minHeight: 148, gap: 7, padding: 14 },
  addCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  addText: { flex: 1, color: colors.muted, fontSize: 12 },
  addButton: { color: colors.background, backgroundColor: colors.primary, fontWeight: "800", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, overflow: "hidden" },
  savingsValue: { color: colors.text, fontSize: 28, fontWeight: "800" },
  sparkWrap: { height: 36, flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 2 },
  sparkBar: { flex: 1, maxWidth: 16, borderRadius: 4, opacity: 0.8 },
  twoColumn: { flexDirection: "row", gap: 12 },
  oneColumn: { flexDirection: "column" },
  largeCard: { flex: 1, minWidth: 0 },
  smallCard: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  panelValue: { color: colors.text, fontSize: 29, fontWeight: "800", marginTop: 2 },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 2 },
  rangeRow: { flexDirection: "row", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" },
  rangePill: { paddingHorizontal: 7, paddingVertical: 5, backgroundColor: colors.surfaceRaised, borderRadius: 7 },
  rangeActive: { backgroundColor: colors.surfaceHover },
  rangeText: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  legendRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 999 },
  legendText: { color: colors.muted, fontSize: 10 },
  chartArea: { height: 170, position: "relative", marginTop: 4 },
  chartGrid: { ...StyleSheet.absoluteFillObject },
  gridLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: colors.border, opacity: 0.55 },
  barChart: { position: "absolute", left: 2, right: 2, top: 10, bottom: 22, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  barGroup: { flex: 1, alignItems: "center", gap: 5 },
  barPair: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 118 },
  chartBar: { width: 6, borderRadius: 3 },
  chartLabel: { color: colors.subtle, fontSize: 8 },
  categoryRow: { gap: 6 },
  categoryName: { color: colors.text, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  categoryTrack: { height: 6, borderRadius: 999, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  categoryFill: { height: "100%", borderRadius: 999 },
  transactionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  transactionTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  transactionAmount: { fontSize: 12, fontWeight: "800" },
  budgetRow: { gap: 6 },
  budgetAmounts: { color: colors.muted, fontSize: 10 },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  netWorth: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 4 },
  healthGrade: { color: colors.primary, fontWeight: "800", fontSize: 12 },
  link: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  accountRow: { gap: 10, paddingTop: 8 },
  accountCard: { width: 190, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
});
