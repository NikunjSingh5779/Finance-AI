import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Circle, Path } from "react-native-svg";
import {
  Card,
  ErrorBanner,
  Header,
  LoadingState,
  Money,
  Pill,
  ProgressBar,
  Screen,
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

const WEB_LIKE_CATEGORY_COLORS = [
  "#22c55e",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
  "#a855f7",
  "#f97316",
];

const AnimatedView = Animated.View;

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

function linePath(values: number[], width: number, height: number, padding = 8) {
  if (!values.length) return "";
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  const min = Math.min(...values.map((value) => value), 0);
  const range = Math.max(max - min, 1);

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
}

function AnimatedMiniChart({ values, color = colors.primary }: { values: number[]; color?: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <AnimatedView style={[styles.miniChart, { opacity, transform: [{ translateY }] }]}>
      <Svg width="100%" height="42" viewBox="0 0 240 42">
        <Path
          d={linePath(values.slice(-12), 240, 42, 4)}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </AnimatedView>
  );
}

function CashFlowChart({ monthly }: { monthly: Summary["monthly"] }) {
  const points = Object.entries(monthly || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  const income = points.map(([, value]) => Number(value.income || 0));
  const expense = points.map(([, value]) => Number(value.expense || 0));

  const max = Math.max(...income, ...expense, 1);
  const width = 360;
  const height = 190;
  const paddingX = 14;
  const paddingY = 12;

  const buildPath = (values: number[]) =>
    values.map((value, index) => {
      const x = values.length <= 1 ? width / 2 : paddingX + (index / (values.length - 1)) * (width - paddingX * 2);
      const y = height - paddingY - (value / max) * (height - paddingY * 2);
      return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");

  return (
    <View style={styles.cashChart}>
      <Svg width="100%" height="190" viewBox={`0 0 ${width} ${height}`}>
        {[0, 1, 2, 3, 4].map((row) => (
          <Path
            key={row}
            d={`M0 ${18 + row * 40} L${width} ${18 + row * 40}`}
            stroke={colors.border}
            strokeWidth="1"
            opacity={0.6}
          />
        ))}
        <Path d={buildPath(income)} fill="none" stroke={colors.primary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={buildPath(expense)} fill="none" stroke={colors.danger} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>

      <View style={styles.chartAxisLabels}>
        {points.map(([month]) => <Text key={month} style={styles.chartLabel}>{month.slice(5)}</Text>)}
      </View>
    </View>
  );
}

function SpendingDonut({ categories }: { categories: Array<[string, number]> }) {
  const total = categories.reduce((sum, [, value]) => sum + Number(value), 0);
  const radius = 66;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <View style={styles.donutWrap}>
      <Svg width={170} height={170} viewBox="0 0 170 170">
        <Circle cx="85" cy="85" r={radius} stroke={colors.surfaceRaised} strokeWidth="28" fill="none" />
        {categories.map(([category, value], index) => {
          const portion = total > 0 ? Number(value) / total : 0;
          const segment = circumference * portion;
          const dashOffset = -offset;
          offset += segment;
          return (
            <Circle
              key={category}
              cx="85"
              cy="85"
              r={radius}
              stroke={WEB_LIKE_CATEGORY_COLORS[index % WEB_LIKE_CATEGORY_COLORS.length]}
              strokeWidth="28"
              fill="none"
              strokeDasharray={`${segment} ${circumference - segment}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              rotation="-90"
              origin="85, 85"
            />
          );
        })}
      </Svg>
      <View style={styles.donutCenter}>
        <Text style={styles.donutLabel}>TOTAL</Text>
        <Text style={styles.donutValue}>{money(total)}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { api, ready } = useFinance();
  const { width } = useWindowDimensions();
  const compact = width < 720;

  const [selectedRange, setSelectedRange] = useState<"1M" | "3M" | "6M" | "1Y" | "All">("1Y");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryAll, setSummaryAll] = useState<Summary | null>(null);
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
    try {
      const [selectedResult, allResult, txnResult, accountResult, budgetResult, insightResult, netResult, forecastResult] =
        await Promise.allSettled([
          api.summary(selectedRange === "All" ? "all" : selectedRange === "1M" ? "1m" : selectedRange === "3M" ? "3m" : selectedRange === "6M" ? "6m" : "1y"),
          api.summary("all"),
          api.transactions(5000),
          api.accounts(),
          api.budgets(),
          api.insightsDashboard(),
          api.netWorth(),
          api.forecast(),
        ]);

      if (selectedResult.status === "fulfilled") setSummary(selectedResult.value);
      if (allResult.status === "fulfilled") setSummaryAll(allResult.value);
      if (txnResult.status === "fulfilled") setTransactions(txnResult.value);
      if (accountResult.status === "fulfilled") setAccounts(accountResult.value);
      if (budgetResult.status === "fulfilled") setBudgets(budgetResult.value);
      if (insightResult.status === "fulfilled") setInsights(insightResult.value);
      if (netResult.status === "fulfilled") setNetWorth(netResult.value);
      if (forecastResult.status === "fulfilled") setForecast(forecastResult.value);

      const failure = [selectedResult, txnResult, accountResult].find((item) => item.status === "rejected");
      if (failure?.status === "rejected") {
        setError(failure.reason instanceof Error ? failure.reason.message : "Some dashboard data could not be loaded.");
      }
    } finally {
      setLoading(false);
    }
  }, [api, ready, selectedRange]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const balance = summary?.balance ?? 0;
  const totalBalance = summaryAll?.balance ?? balance;
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

  const rangeLabel =
    selectedRange === "1M" ? "this month" :
    selectedRange === "3M" ? "last 3 months" :
    selectedRange === "6M" ? "last 6 months" :
    selectedRange === "1Y" ? "last 12 months" : "all time";

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
          <View style={styles.rowBetween}><SmallText>Total balance</SmallText><SmallText>All time</SmallText></View>
          <Money value={totalBalance} size={29} />
          <SmallText>after all recorded income & expenses</SmallText>
          <AnimatedMiniChart values={cashNet} />
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Income</SmallText><SmallText>{rangeLabel}</SmallText></View>
          <Money value={income} size={29} />
          <SmallText>recorded income</SmallText>
          <AnimatedMiniChart values={cashIncome} />
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Expenses</SmallText><SmallText>{rangeLabel}</SmallText></View>
          <Money value={-expense} size={29} />
          <SmallText>recorded spending</SmallText>
          <AnimatedMiniChart values={cashExpense} color={colors.danger} />
        </Card>

        <Card style={styles.summaryCard}>
          <View style={styles.rowBetween}><SmallText>Savings rate</SmallText><SmallText>goal: 40%</SmallText></View>
          <Text style={styles.savingsValue}>{savingsRate.toFixed(1)}%</Text>
          <ProgressBar value={savingsRate} tone={savingsRate >= 40 ? "primary" : "warning"} />
          <SmallText>{savingsRate >= 40 ? "Healthy" : "Needs attention"}</SmallText>
        </Card>
      </View>

      <Pressable
        onPress={() => router.push("/transactions")}
        style={({ pressed }) => [styles.addCard, pressed && { opacity: 0.86 }]}
      >
        <Text style={styles.addButtonText}>+ Add transaction</Text>
      </Pressable>

      <View style={[styles.twoColumn, compact && styles.oneColumn]}>
        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View>
              <SmallText>Cash flow • Income vs. expenses</SmallText>
              <Text style={styles.panelValue}>{MoneyText(balance)}</Text>
              <Pill tone={balance >= 0 ? "success" : "danger"}>{balance >= 0 ? "Net positive" : "Net negative"}</Pill>
            </View>
          </View>

          <View style={styles.rangeRow}>
            {["1M", "3M", "6M", "1Y", "All"].map((range) => {
              const active = selectedRange === range;
              return (
                <Pressable
                  key={range}
                  onPress={() => setSelectedRange(range as typeof selectedRange)}
                  style={[styles.rangePill, active && styles.rangeActive]}
                >
                  <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{range}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legendRow}>
            <Legend color={colors.primary} text={"Income " + money(income)} />
            <Legend color={colors.danger} text={"Expenses " + money(expense)} />
          </View>
          <CashFlowChart monthly={summary?.monthly ?? {}} />
        </Card>

        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View><SmallText>Spending by category</SmallText><Text style={styles.panelTitle}>{selectedRange === "All" ? "All time" : rangeLabel}</Text></View>
            <Pressable onPress={() => router.push("/transactions")}><Text style={styles.link}>View all</Text></Pressable>
          </View>

          <SpendingDonut categories={categories} />
          <View style={styles.categoryList}>
            {categories.map(([category, amount], index) => {
              const total = categories.reduce((sum, [, value]) => sum + value, 0) || 1;
              return (
                <View key={category} style={styles.categoryLegendRow}>
                  <View style={styles.categoryLegendLeft}>
                    <View style={[styles.legendDot, { backgroundColor: WEB_LIKE_CATEGORY_COLORS[index % WEB_LIKE_CATEGORY_COLORS.length] }]} />
                    <Text style={styles.categoryName}>{category}</Text>
                  </View>
                  <Text style={styles.categoryPercent}>{Math.round((amount / total) * 100)}%</Text>
                  <Text style={styles.categoryAmount}>{money(amount)}</Text>
                </View>
              );
            })}
            {!categories.length ? <SmallText>No expense data for this period.</SmallText> : null}
          </View>
        </Card>
      </View>

      <View style={[styles.twoColumn, compact && styles.oneColumn]}>
        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View><SmallText>Recent transactions</SmallText><Text style={styles.panelTitle}>Latest activity</Text></View>
            <Pressable onPress={() => router.push("/transactions")}><Text style={styles.link}>View all</Text></Pressable>
          </View>
          {transactions.slice(0, 6).map((txn) => (
            <Pressable key={txn.id} onPress={() => router.push("/transactions")} style={styles.transactionRow}>
              <View style={[styles.iconBox, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.dangerSoft }]}>
                <Text style={{ color: txn.type === "income" ? colors.primary : colors.danger, fontSize: 16 }}>{txn.type === "income" ? "↗" : "↘"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.transactionTitle} numberOfLines={1}>{txn.description}</Text>
                <SmallText>{txn.category} · {txn.date}</SmallText>
              </View>
              <Text style={[styles.transactionAmount, { color: txn.type === "income" ? colors.primary : colors.danger }]}>{txn.type === "income" ? "+" : "-"}₹{txn.amount.toLocaleString("en-IN")}</Text>
            </Pressable>
          ))}
          {!transactions.length ? <SmallText>No transactions yet.</SmallText> : null}
        </Card>

        <Card style={styles.largeCard}>
          <View style={styles.rowBetween}>
            <View><SmallText>Budgets</SmallText><Text style={styles.panelTitle}>{budgets.length} active budgets</Text></View>
            <Pressable onPress={() => router.push("/planning")}><Text style={styles.link}>Manage</Text></Pressable>
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
            <View style={styles.rowBetween}><SmallText>Net worth</SmallText><Pill tone={netWorth.net_worth >= 0 ? "success" : "danger"}>{netWorth.net_worth >= 0 ? "Positive" : "Negative"}</Pill></View>
            <Text style={styles.netWorth}>{money(netWorth.net_worth)}</Text>
            <View style={styles.statsRow}>
              <View><SmallText>Assets</SmallText><Text style={styles.statValue}>{money(netWorth.asset_total)}</Text></View>
              <View><SmallText>Liabilities</SmallText><Text style={styles.statValue}>{money(netWorth.liability_total)}</Text></View>
            </View>
          </Card>
        ) : null}

        {insights ? (
          <Pressable onPress={() => router.push("/insights")} style={styles.smallCardWrap}>
            <Card style={styles.smallCard}>
              <View style={styles.rowBetween}><SmallText>AI insights</SmallText><Pill tone="success">Updated now</Pill></View>
              <Text style={styles.netWorth}>{insights.health.score}/100</Text>
              <Text style={styles.healthGrade}>{insights.health.grade}</Text>
              <ProgressBar value={insights.health.score} />
              <Text style={styles.link}>View insights</Text>
            </Card>
          </Pressable>
        ) : null}

        {forecast ? (
          <Card style={styles.smallCard}>
            <View style={styles.rowBetween}><SmallText>Next-month expense estimate</SmallText><Pill tone="info">{forecast.confidence.toFixed(0)}% confidence</Pill></View>
            <Text style={[styles.netWorth, { color: colors.primary }]}>{money(forecast.prediction)}</Text>
            <SmallText>{forecast.next_month} · {forecast.model_used}</SmallText>
          </Card>
        ) : null}
      </View>

      <Card>
        <View style={styles.rowBetween}>
          <View><SmallText>Accounts</SmallText><Text style={styles.panelTitle}>{accounts.length} configured</Text></View>
          <Pressable onPress={() => router.push("/settings")}><Text style={styles.link}>Manage</Text></Pressable>
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

function MoneyText(value: number) {
  return (value < 0 ? "-₹" : "₹") + Math.abs(value).toLocaleString("en-IN");
}

function Legend({ color, text }: { color: string; text: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 2, paddingTop: 2, gap: 4 },
  greeting: { color: colors.muted, fontSize: 13 },
  heroTitle: { color: colors.text, fontSize: 29, fontWeight: "800", letterSpacing: -0.7 },
  heroSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryGridCompact: { flexWrap: "wrap" },
  summaryCard: { flex: 1, minWidth: 0, minHeight: 148, gap: 7, padding: 14 },
  addCard: { minHeight: 43, borderRadius: 9, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  addButtonText: { color: colors.background, fontSize: 13, fontWeight: "800" },
  savingsValue: { color: colors.text, fontSize: 28, fontWeight: "800" },
  miniChart: { height: 42, width: "100%", marginTop: 2 },
  twoColumn: { flexDirection: "row", gap: 12 },
  oneColumn: { flexDirection: "column" },
  largeCard: { flex: 1, minWidth: 0 },
  smallCard: { flex: 1, minWidth: 0 },
  smallCardWrap: { flex: 1 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  panelValue: { color: colors.text, fontSize: 29, fontWeight: "800", marginTop: 2 },
  panelTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 2 },
  rangeRow: { flexDirection: "row", gap: 5, justifyContent: "flex-end", flexWrap: "wrap" },
  rangePill: { paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.surfaceRaised, borderRadius: 7 },
  rangeActive: { backgroundColor: colors.surfaceHover },
  rangeText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  rangeTextActive: { color: colors.text },
  legendRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 999 },
  legendText: { color: colors.muted, fontSize: 10 },
  cashChart: { height: 215, position: "relative", marginTop: 2 },
  chartAxisLabels: { position: "absolute", left: 8, right: 8, bottom: 0, flexDirection: "row", justifyContent: "space-between" },
  chartLabel: { color: colors.subtle, fontSize: 9 },
  donutWrap: { height: 185, alignItems: "center", justifyContent: "center", position: "relative" },
  donutCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  donutLabel: { color: colors.subtle, fontSize: 9, fontWeight: "700" },
  donutValue: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 3 },
  categoryList: { gap: 7 },
  categoryLegendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryLegendLeft: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
  categoryName: { color: colors.text, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  categoryPercent: { color: colors.muted, fontSize: 10, width: 32, textAlign: "right" },
  categoryAmount: { color: colors.text, fontSize: 11, fontWeight: "700", width: 78, textAlign: "right" },
  transactionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  transactionTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  transactionAmount: { fontSize: 12, fontWeight: "800" },
  budgetRow: { gap: 6, marginTop: 3 },
  budgetAmounts: { color: colors.muted, fontSize: 10 },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  netWorth: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 4 },
  healthGrade: { color: colors.primary, fontWeight: "800", fontSize: 12 },
  link: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  accountRow: { gap: 10, paddingTop: 8 },
  accountCard: { width: 190, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
});
