import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
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
  Forecast,
  InsightsDashboard,
  NetWorthSnapshot,
  Summary,
  Transaction,
} from "../src/types";
import { colors } from "../src/theme";

const WEB_CHART_COLORS = ["#22c55e", "#f59e0b", "#3b82f6", "#ef4444", "#a855f7", "#f97316"];

function WebLineChart({
  monthly,
}: {
  monthly: Record<string, { income: number; expense: number }>;
}) {
  const points = Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12);

  const max = Math.max(
    ...points.flatMap(([, value]) => [value.income, value.expense]),
    1,
  );

  const buildPoints = (key: "income" | "expense") =>
    points.map(([, value], index) => ({
      x: points.length === 1 ? 50 : (index / (points.length - 1)) * 100,
      y: 92 - (value[key] / max) * 78,
      value: value[key],
    }));

  const drawSeries = (series: Array<{ x: number; y: number }>, color: string) =>
    series.slice(0, -1).map((point, index) => {
      const next = series[index + 1];
      const dx = next.x - point.x;
      const dy = next.y - point.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      return (
        <View
          key={color + "-" + index}
          style={[
            styles.webChartSegment,
            {
              left: `${point.x}%`,
              top: `${point.y}%`,
              width: `${length}%`,
              backgroundColor: color,
              transform: [{ rotate: `${angle}deg` }],
            },
          ]}
        />
      );
    });

  const incomeSeries = buildPoints("income");
  const expenseSeries = buildPoints("expense");

  return (
    <View style={styles.webLineChart}>
      {[0, 1, 2, 3, 4].map((row) => (
        <View key={row} style={[styles.webGridLine, { top: `${row * 25}%` }]} />
      ))}

      {drawSeries(incomeSeries, "#22c55e")}
      {drawSeries(expenseSeries, "#ef4444")}

      {incomeSeries.map((point, index) => (
        <View
          key={"income-dot-" + index}
          style={[
            styles.webChartDot,
            { left: `${point.x}%`, top: `${point.y}%`, backgroundColor: "#22c55e" },
          ]}
        />
      ))}
      {expenseSeries.map((point, index) => (
        <View
          key={"expense-dot-" + index}
          style={[
            styles.webChartDot,
            { left: `${point.x}%`, top: `${point.y}%`, backgroundColor: "#ef4444" },
          ]}
        />
      ))}

      <View style={styles.webChartLabels}>
        {points.map(([month]) => (
          <Text key={month} style={styles.webChartLabel}>
            {month.slice(5)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function WebHomeDashboard({
  summary,
  transactions,
  accounts,
  insights,
  netWorth,
  forecast,
  onAdd,
  onTransactions,
  onInsights,
}: {
  summary: Summary | null;
  transactions: Transaction[];
  accounts: Account[];
  insights: InsightsDashboard | null;
  netWorth: NetWorthSnapshot | null;
  forecast: Forecast | null;
  onAdd: () => void;
  onTransactions: () => void;
  onInsights: () => void;
}) {
  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const balance = summary?.balance ?? 0;
  const savingsRate = summary?.savings_rate ?? 0;
  const categories = Object.entries(summary?.category_totals ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const categoryTotal = categories.reduce((sum, [, amount]) => sum + amount, 0);
  const categoryStops = categories.length
    ? (() => {
        let cursor = 0;
        return categories
          .map(([, amount], index) => {
            const start = (cursor / categoryTotal) * 100;
            cursor += amount;
            const end = (cursor / categoryTotal) * 100;
            return `${WEB_CHART_COLORS[index % WEB_CHART_COLORS.length]} ${start}% ${end}%`;
          })
          .join(", ");
      })()
    : "#1c1c1f 0 100%";

  return (
    <View style={styles.webHome}>
      <View style={styles.webHero}>
        <Text style={styles.webGreeting}>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}</Text>
        <Text style={styles.webHeroTitle}>Here's your money, at a glance.</Text>
        <Text style={styles.webHeroSubtitle}>
          Your savings rate is {savingsRate.toFixed(1)}%. {savingsRate >= 40 ? "Keep building consistent cash flow." : "Focus on building a stronger savings buffer."}
        </Text>
      </View>

      <View style={styles.webSummaryGrid}>
        <View style={styles.webSummaryCard}>
          <Text style={styles.webCardLabel}>Total balance</Text>
          <Text style={[styles.webMoney, { color: colors.text }]}>₹{balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.webCardSub}>after all recorded income & expenses</Text>
          <View style={styles.webSparkRow}>
            {[38, 46, 52, 39, 60, 48, 54, 45, 57, 49].map((h, i) => <View key={i} style={[styles.webSparkBar, { height: h * 0.55, backgroundColor: "#22c55e" }]} />)}
          </View>
        </View>

        <View style={styles.webSummaryCard}>
          <Text style={styles.webCardLabel}>Income</Text>
          <Text style={[styles.webMoney, { color: colors.primary }]}>₹{income.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.webCardSub}>this month</Text>
          <View style={styles.webSparkRow}>
            {[30, 48, 36, 56, 42, 66, 50, 59, 44, 62].map((h, i) => <View key={i} style={[styles.webSparkBar, { height: h * 0.55, backgroundColor: "#22c55e" }]} />)}
          </View>
        </View>

        <View style={styles.webSummaryCard}>
          <Text style={styles.webCardLabel}>Expenses</Text>
          <Text style={[styles.webMoney, { color: colors.danger }]}>₹{expense.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.webCardSub}>this month</Text>
          <View style={styles.webSparkRow}>
            {[42, 34, 51, 59, 72, 46, 64, 50, 61, 44].map((h, i) => <View key={i} style={[styles.webSparkBar, { height: h * 0.55, backgroundColor: "#ef4444" }]} />)}
          </View>
        </View>

        <View style={styles.webSummaryCard}>
          <Text style={styles.webCardLabel}>Savings rate</Text>
          <Text style={[styles.webMoney, { color: colors.text }]}>{savingsRate.toFixed(1)}%</Text>
          <Text style={styles.webCardSub}>goal: 40%</Text>
          <View style={styles.webRateTrack}>
            <View style={[styles.webRateFill, { width: `${Math.min(100, Math.max(0, savingsRate))}%` }]} />
          </View>
        </View>
      </View>

      <Pressable onPress={onAdd} style={styles.webFullAdd}>
        <Text style={styles.webFullAddText}>+ Add transaction</Text>
      </Pressable>

      <View style={styles.webMainGrid}>
        <View style={styles.webPanel}>
          <View style={styles.webPanelHeader}>
            <View>
              <Text style={styles.webPanelLabel}>Cash flow • Income vs. expenses</Text>
              <Text style={styles.webPanelValue}>₹{balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Text>
              <Pill tone={balance >= 0 ? "success" : "danger"}>{balance >= 0 ? "Net positive" : "Net negative"}</Pill>
            </View>
            <View style={styles.webRangePills}>
              {["1M", "3M", "6M", "1Y", "All"].map((item, i) => (
                <View key={item} style={[styles.webRangePill, i === 4 && styles.webRangeActive]}>
                  <Text style={styles.webRangeText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.webLegendRow}>
            <View style={styles.webLegendItem}><View style={[styles.webLegendDot, { backgroundColor: "#22c55e" }]} /><Text style={styles.webLegendText}>Income ₹{income.toLocaleString("en-IN")}</Text></View>
            <View style={styles.webLegendItem}><View style={[styles.webLegendDot, { backgroundColor: "#ef4444" }]} /><Text style={styles.webLegendText}>Expenses ₹{expense.toLocaleString("en-IN")}</Text></View>
          </View>
          <WebLineChart monthly={summary?.monthly ?? {}} />
        </View>

        <View style={styles.webPanel}>
          <View style={styles.webPanelHeaderRow}>
            <View>
              <Text style={styles.webPanelLabel}>Spending by category</Text>
              <Text style={styles.webPanelTitle}>All time</Text>
            </View>
            <Pressable onPress={onTransactions}><Text style={styles.webLink}>View all</Text></Pressable>
          </View>

          <View style={styles.webDonutWrap}>
            <View style={[styles.webDonut, { backgroundImage: `conic-gradient(${categoryStops})` } as any]}>
              <View style={styles.webDonutInner}>
                <Text style={styles.webDonutLabel}>TOTAL</Text>
                <Text style={styles.webDonutValue}>₹{categoryTotal.toLocaleString("en-IN")}</Text>
              </View>
            </View>
          </View>

          <View style={styles.webCategoryList}>
            {categories.map(([category, amount], index) => (
              <View key={category} style={styles.webCategoryRow}>
                <View style={styles.webCategoryNameWrap}>
                  <View style={[styles.webLegendDot, { backgroundColor: WEB_CHART_COLORS[index % WEB_CHART_COLORS.length] }]} />
                  <Text style={styles.webCategoryName}>{category}</Text>
                </View>
                <Text style={styles.webCategoryAmount}>₹{amount.toLocaleString("en-IN")}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.webBottomGrid}>
        <View style={styles.webPanel}>
          <View style={styles.webPanelHeaderRow}>
            <View>
              <Text style={styles.webPanelLabel}>Recent transactions</Text>
              <Text style={styles.webPanelTitle}>Latest activity</Text>
            </View>
            <Pressable onPress={onTransactions}><Text style={styles.webLink}>View all</Text></Pressable>
          </View>
          {transactions.slice(0, 5).map((txn) => (
            <View key={txn.id} style={styles.webTxnRow}>
              <View style={[styles.webTxnIcon, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.dangerSoft }]}>
                <Text style={{ color: txn.type === "income" ? colors.primary : colors.danger }}>{txn.type === "income" ? "↗" : "↘"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.webTxnTitle} numberOfLines={1}>{txn.description}</Text>
                <Text style={styles.webTxnMeta}>{txn.category} • {txn.date}</Text>
              </View>
              <Text style={[styles.webTxnAmount, { color: txn.type === "income" ? colors.primary : colors.danger }]}>
                {txn.type === "income" ? "+" : "-"}₹{txn.amount.toLocaleString("en-IN")}
              </Text>
            </View>
          ))}
          {!transactions.length ? <SmallText>No transactions yet.</SmallText> : null}
        </View>

        <View style={styles.webSideStack}>
          {netWorth ? (
            <View style={styles.webPanel}>
              <Text style={styles.webPanelLabel}>Net worth</Text>
              <Text style={styles.webNetWorth}>₹{netWorth.net_worth.toLocaleString("en-IN")}</Text>
              <View style={styles.webThreeStats}>
                <View><Text style={styles.webStatLabel}>Assets</Text><Text style={styles.webStatValue}>₹{netWorth.asset_total.toLocaleString("en-IN")}</Text></View>
                <View><Text style={styles.webStatLabel}>Liabilities</Text><Text style={styles.webStatValue}>₹{netWorth.liability_total.toLocaleString("en-IN")}</Text></View>
              </View>
            </View>
          ) : null}

          {insights ? (
            <Pressable onPress={onInsights} style={styles.webPanel}>
              <Text style={styles.webPanelLabel}>Financial health</Text>
              <View style={styles.webHealthRow}>
                <View>
                  <Text style={styles.webHealthScore}>{insights.health.score}/100</Text>
                  <Text style={styles.webHealthGrade}>{insights.health.grade}</Text>
                </View>
                <View style={{ flex: 1, gap: 7 }}>
                  <ProgressBar value={insights.health.score} />
                  <Text style={styles.webStatLabel}>{insights.counts.recurring} recurring • {insights.counts.anomalies} unusual</Text>
                </View>
              </View>
            </Pressable>
          ) : null}

          {forecast ? (
            <View style={styles.webPanel}>
              <View style={styles.webPanelHeaderRow}>
                <View>
                  <Text style={styles.webPanelLabel}>Next-month expense estimate</Text>
                  <Text style={styles.webForecast}>₹{forecast.prediction.toLocaleString("en-IN")}</Text>
                </View>
                <Pill tone="info">{forecast.confidence.toFixed(0)}% confidence</Pill>
              </View>
              <Text style={styles.webStatLabel}>{forecast.next_month} • {forecast.model_used}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.webPanel}>
        <View style={styles.webPanelHeaderRow}>
          <View>
            <Text style={styles.webPanelLabel}>Accounts</Text>
            <Text style={styles.webPanelTitle}>Your accounts</Text>
          </View>
        </View>
        <View style={styles.webAccountsRow}>
          {accounts.slice(0, 4).map((account) => (
            <View key={account.id} style={styles.webAccountItem}>
              <Text style={styles.webTxnTitle}>{account.name}</Text>
              <Text style={styles.webTxnMeta}>{account.type}</Text>
              <Text style={styles.webAccountBalance}>₹{(account.current_balance ?? account.balance).toLocaleString("en-IN")}</Text>
            </View>
          ))}
          {!accounts.length ? <SmallText>No accounts configured.</SmallText> : null}
        </View>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { api, ready } = useFinance();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
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
      api.summary("1m"),
      api.transactions(12),
      api.accounts(),
      api.insightsDashboard(),
      api.netWorth(),
      api.forecast(),
    ]);

    const failures: string[] = [];
    const summaryResult = results[0];
    const transactionResult = results[1];
    const accountResult = results[2];
    const insightResult = results[3];
    const netWorthResult = results[4];
    const forecastResult = results[5];

    if (summaryResult?.status === "fulfilled") setSummary(summaryResult.value);
    else if (summaryResult?.status === "rejected") failures.push(String(summaryResult.reason));

    if (transactionResult?.status === "fulfilled") setTransactions(transactionResult.value);
    else if (transactionResult?.status === "rejected") failures.push(String(transactionResult.reason));

    if (accountResult?.status === "fulfilled") setAccounts(accountResult.value);
    else if (accountResult?.status === "rejected") failures.push(String(accountResult.reason));

    if (insightResult?.status === "fulfilled") setInsights(insightResult.value);
    else if (insightResult?.status === "rejected") failures.push(String(insightResult.reason));

    if (netWorthResult?.status === "fulfilled") setNetWorth(netWorthResult.value);
    else if (netWorthResult?.status === "rejected") failures.push(String(netWorthResult.reason));

    if (forecastResult?.status === "fulfilled") setForecast(forecastResult.value);
    if (forecastResult?.status === "rejected") failures.push("Expense forecast unavailable");

    if (failures.length) {
      setError(failures[0] || "Some dashboard data could not be loaded.");
    }
    setLoading(false);
  }, [api, ready]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading && !summary) {
    return <Screen><LoadingState /></Screen>;
  }

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const savingsRate = summary?.savings_rate ?? 0;
  const categories = Object.entries(summary?.category_totals ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (Platform.OS === "web") {
    return (
      <WebHomeDashboard
        summary={summary}
        transactions={transactions}
        accounts={accounts}
        insights={insights}
        netWorth={netWorth}
        forecast={forecast}
        onAdd={() => router.push("/transactions")}
        onTransactions={() => router.push("/transactions")}
        onInsights={() => router.push("/insights")}
      />
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <Header title="FinanceAI" subtitle="Your money, decisions and progress in one place." />
      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.summaryGrid}>
        <Card style={styles.summaryCard}>
          <SmallText>Total balance</SmallText>
          <Money value={summary?.balance ?? 0} size={24} />
          <SmallText>all recorded cash flow</SmallText>
        </Card>

        <Card style={styles.summaryCard}>
          <SmallText>Income</SmallText>
          <Money value={income} size={24} />
          <SmallText>this month</SmallText>
        </Card>

        <Card style={styles.summaryCard}>
          <SmallText>Expenses</SmallText>
          <Money value={-expense} size={24} />
          <SmallText>this month</SmallText>
        </Card>

        <Card style={styles.summaryCard}>
          <SmallText>Savings rate</SmallText>
          <Text style={styles.savingsValue}>{savingsRate.toFixed(1)}%</Text>
          <Pill tone={savingsRate >= 20 ? "success" : "warning"}>
            {savingsRate >= 20 ? "Healthy" : "Needs attention"}
          </Pill>
        </Card>
      </View>

      <Button title="+ Add transaction" onPress={() => router.push("/transactions")} />

      {netWorth ? (
        <Card>
          <SectionTitle>Net worth</SectionTitle>
          <View style={styles.rowBetween}>
            <View>
              <SmallText>Assets</SmallText>
              <Money value={netWorth.asset_total} size={20} />
            </View>
            <View>
              <SmallText>Liabilities</SmallText>
              <Money value={-netWorth.liability_total} size={20} />
            </View>
            <View>
              <SmallText>Net</SmallText>
              <Money value={netWorth.net_worth} size={20} />
            </View>
          </View>
        </Card>
      ) : null}

      {insights ? (
        <Pressable onPress={() => router.push("/insights")}>
          <Card>
            <View style={styles.rowBetween}>
              <View>
                <SmallText>Financial health</SmallText>
                <Text style={styles.score}>{insights.health.score}/100</Text>
                <Text style={styles.grade}>{insights.health.grade}</Text>
              </View>
              <View style={{ width: 130, gap: 8 }}>
                <ProgressBar value={insights.health.score} />
                <SmallText>
                  {insights.counts.recurring} recurring · {insights.counts.anomalies} unusual
                </SmallText>
              </View>
            </View>
          </Card>
        </Pressable>
      ) : null}

      {forecast ? (
        <Card>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <SmallText>Next-month expense estimate</SmallText>
              <Money value={forecast.prediction} size={27} />
            </View>
            <Pill tone="info">{forecast.confidence.toFixed(0)}% confidence</Pill>
          </View>
          <SmallText>
            {forecast.next_month} · {forecast.model_used}
          </SmallText>
        </Card>
      ) : null}

      <SectionTitle>Top spending categories</SectionTitle>
      <Card>
        {categories.length === 0 ? (
          <SmallText>No expense categories yet.</SmallText>
        ) : (
          categories.map(([category, amount]) => {
            const max = categories[0]?.[1] || 1;
            return (
              <View key={category} style={{ gap: 6 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.itemTitle}>{category}</Text>
                  <Money value={amount} size={14} />
                </View>
                <ProgressBar value={amount} max={max} tone="info" />
              </View>
            );
          })
        )}
      </Card>

      <View style={styles.rowBetween}>
        <SectionTitle>Recent activity</SectionTitle>
        <Pressable onPress={() => router.push("/transactions")}>
          <Text style={styles.link}>View all</Text>
        </Pressable>
      </View>

      <Card>
        {transactions.length === 0 ? (
          <SmallText>No transactions yet.</SmallText>
        ) : (
          transactions.slice(0, 6).map((txn) => (
            <View key={txn.id} style={styles.transactionRow}>
              <View style={[styles.dot, { backgroundColor: txn.type === "income" ? colors.primary : colors.danger }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{txn.description}</Text>
                <SmallText>{txn.category} · {txn.date}</SmallText>
              </View>
              <Text style={[styles.amount, { color: txn.type === "income" ? colors.primary : colors.danger }]}>
                {txn.type === "income" ? "+" : "-"}₹{txn.amount.toLocaleString("en-IN")}
              </Text>
            </View>
          ))
        )}
      </Card>

      <SectionTitle>Accounts</SectionTitle>
      <Card>
        {accounts.length === 0 ? (
          <SmallText>No accounts yet.</SmallText>
        ) : (
          accounts.map((account) => (
            <View key={account.id} style={styles.transactionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{account.name}</Text>
                <SmallText>{account.type}</SmallText>
              </View>
              <Money value={account.current_balance ?? account.balance} size={16} />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  webHome: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 10,
  },
  webHero: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  webGreeting: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 3,
  },
  webHeroTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  webHeroSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 7,
  },
  webSummaryGrid: {
    flexDirection: "row",
    gap: 10,
  },
  webSummaryCard: {
    flex: 1,
    minHeight: 154,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    justifyContent: "space-between",
  },
  webCardLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  webMoney: {
    fontSize: 24,
    fontWeight: "800",
    marginTop: 8,
  },
  webCardSub: {
    color: colors.subtle,
    fontSize: 11,
    marginTop: 3,
  },
  webSparkRow: {
    height: 36,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
  },
  webSparkBar: {
    flex: 1,
    maxWidth: 14,
    borderRadius: 4,
    opacity: 0.8,
  },
  webRateTrack: {
    height: 7,
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  webRateFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.warning,
  },
  webFullAdd: {
    minHeight: 42,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  webFullAddText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "800",
  },
  webMainGrid: {
    flexDirection: "row",
    gap: 12,
  },
  webPanel: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  webMainGridChild: {
    flex: 1,
  },
  webPanelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  webPanelHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  webPanelLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  webPanelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },
  webPanelValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    marginVertical: 3,
  },
  webRangePills: {
    flexDirection: "row",
    gap: 4,
  },
  webRangePill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: colors.surfaceRaised,
  },
  webRangeActive: {
    backgroundColor: colors.surfaceHover,
  },
  webRangeText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  webLegendRow: {
    flexDirection: "row",
    gap: 14,
    flexWrap: "wrap",
  },
  webLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  webLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  webLegendText: {
    color: colors.muted,
    fontSize: 11,
  },
  webLineChart: {
    height: 220,
    marginTop: 4,
    position: "relative",
    overflow: "hidden",
    paddingBottom: 20,
  },
  webGridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.55,
  },
  webChartSegment: {
    position: "absolute",
    height: 2,
    borderRadius: 999,
    transformOrigin: "left center" as never,
  },
  webChartDot: {
    position: "absolute",
    width: 6,
    height: 6,
    marginLeft: -3,
    marginTop: -3,
    borderRadius: 999,
  },
  webChartLabels: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  webChartLabel: {
    color: colors.subtle,
    fontSize: 9,
  },
  webLink: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  webDonutWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  webDonut: {
    width: 170,
    height: 170,
    borderRadius: 85,
    alignItems: "center",
    justifyContent: "center",
  },
  webDonutInner: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  webDonutLabel: {
    color: colors.subtle,
    fontSize: 9,
    fontWeight: "700",
  },
  webDonutValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 3,
  },
  webCategoryList: {
    gap: 7,
  },
  webCategoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  webCategoryNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flex: 1,
  },
  webCategoryName: {
    color: colors.muted,
    fontSize: 11,
    textTransform: "capitalize",
  },
  webCategoryAmount: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  webBottomGrid: {
    flexDirection: "row",
    gap: 12,
  },
  webSideStack: {
    flex: 1,
    gap: 12,
  },
  webTxnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  webTxnIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  webTxnTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  webTxnMeta: {
    color: colors.subtle,
    fontSize: 10,
    marginTop: 2,
  },
  webTxnAmount: {
    fontSize: 12,
    fontWeight: "800",
  },
  webNetWorth: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  webThreeStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  webStatLabel: {
    color: colors.subtle,
    fontSize: 10,
  },
  webStatValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  webHealthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  webHealthScore: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
  webHealthGrade: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  webForecast: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 2,
  },
  webAccountsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  webAccountItem: {
    flex: 1,
    minWidth: 150,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webAccountBalance: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 8,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryCard: {
    width: "48%",
    minHeight: 116,
    justifyContent: "space-between",
    padding: 13,
    gap: 6,
  },
  savingsValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  miniStat: {
    flex: 1,
    gap: 3,
  },
  score: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginTop: 4,
  },
  grade: {
    color: colors.primary,
    fontWeight: "800",
  },
  itemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  link: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  amount: {
    fontWeight: "800",
    fontSize: 13,
  },
});
