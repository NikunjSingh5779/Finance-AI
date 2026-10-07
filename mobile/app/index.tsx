import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
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
