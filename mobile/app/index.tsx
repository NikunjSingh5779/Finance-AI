import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import {
  Card,
  ErrorBanner,
  Header,
  LoadingState,
  Pill,
  ProgressBar,
  Screen,
  SmallText,
} from "../src/components";
import { useFinance } from "../src/AppContext";
import type { Summary, Transaction } from "../src/types";
import { colors } from "../src/theme";

const CATEGORY_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#06b6d4",
];

function formatMoney(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

function dateLabel(date: Date) {
  return date.toLocaleDateString("en-IN", { weekday: "short" });
}

function buildAreaPath(values: number[], width: number, height: number) {
  if (!values.length) return { line: "", area: "" };

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(max - min, 1);

  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 18 - ((value - min) / range) * (height - 38);
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  const area = line + ` L ${width} ${height} L 0 ${height} Z`;
  return { line, area };
}

function AnimatedAreaChart({ values }: { values: number[] }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 750,
      useNativeDriver: false,
    }).start();
  }, [progress, values.join(",")]);

  const { line, area } = buildAreaPath(values, 314, 126);

  return (
    <Animated.View style={[styles.chartWrap, { opacity: progress }]}>
      <Svg width="100%" height="126" viewBox="0 0 314 126">
        <Defs>
          <LinearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#22c55e" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M0 20 L314 20 M0 52 L314 52 M0 84 L314 84 M0 116 L314 116" stroke={colors.border} strokeWidth="1" opacity="0.55" />
        <Path d={area} fill="url(#cashFill)" />
        <Path d={line} fill="none" stroke={colors.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

function MiniLine({ values, color }: { values: number[]; color: string }) {
  const { line } = buildAreaPath(values, 190, 48);
  return (
    <View style={styles.miniLine}>
      <Svg width="100%" height="48" viewBox="0 0 190 48">
        <Path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { api, ready } = useFinance();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryAll, setSummaryAll] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [hiddenBalance, setHiddenBalance] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;

    setError("");
    const results = await Promise.allSettled([
      api.summary("1m"),
      api.summary("all"),
      api.transactions(5000),
    ]);

    const [monthResult, allResult, txnResult] = results;
    if (monthResult.status === "fulfilled") setSummary(monthResult.value);
    if (allResult.status === "fulfilled") setSummaryAll(allResult.value);
    if (txnResult.status === "fulfilled") setTransactions(txnResult.value);

    const failure = results.find((item) => item.status === "rejected");
    if (failure?.status === "rejected") {
      setError(failure.reason instanceof Error ? failure.reason.message : "Could not load dashboard data.");
    }

    setLoading(false);
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const balance = summary?.balance ?? 0;
  const totalBalance = summaryAll?.balance ?? balance;
  const savingsRate = summary?.savings_rate ?? 0;

  const lastSeven = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - index));
      return d;
    });

    return days.map((day) => {
      const key = day.toISOString().slice(0, 10);
      const dayTxns = transactions.filter((txn) => txn.date === key);
      const net = dayTxns.reduce(
        (sum, txn) => sum + (txn.type === "income" ? txn.amount : -txn.amount),
        0,
      );
      return { day, net };
    });
  }, [transactions]);

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    transactions.forEach((txn) => {
      if (txn.type !== "expense") return;
      const txnDate = new Date(txn.date + "T00:00:00");
      const start = new Date();
      start.setDate(start.getDate() - 30);
      if (txnDate < start) return;
      const category = txn.category || "Other";
      totals[category] = (totals[category] || 0) + Number(txn.amount || 0);
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [transactions]);

  const maxCategory = Math.max(...categoryTotals.map(([, amount]) => amount), 1);

  if (loading && !summary) return <Screen><LoadingState /></Screen>;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />
      }
    >
      <Header title="Overview" subtitle="Your personal finance dashboard." />
      {error ? <ErrorBanner message={error} /> : null}

      <Card style={styles.balanceCard}>
        <View style={styles.balanceHeader}>
          <View style={styles.balanceLabelRow}>
            <SmallText>Total Balance</SmallText>
            <Pressable onPress={() => setHiddenBalance((value) => !value)}>
              <Text style={styles.eyeIcon}>{hiddenBalance ? "◉" : "◌"}</Text>
            </Pressable>
          </View>
          <Text style={styles.balanceValue}>
            {hiddenBalance ? "₹ ••••••" : formatMoney(totalBalance)}
          </Text>
        </View>

        <View style={styles.balanceStats}>
          <View style={styles.balanceStat}>
            <View style={[styles.balanceStatIcon, { backgroundColor: colors.primarySoft }]}>
              <Text style={{ color: colors.primary, fontSize: 18 }}>↙</Text>
            </View>
            <View>
              <SmallText>INCOME</SmallText>
              <Text style={styles.balanceStatValue}>{formatMoney(income)}</Text>
            </View>
          </View>

          <View style={styles.balanceStat}>
            <View style={[styles.balanceStatIcon, { backgroundColor: colors.dangerSoft }]}>
              <Text style={{ color: colors.danger, fontSize: 18 }}>↗</Text>
            </View>
            <View>
              <SmallText>EXPENSES</SmallText>
              <Text style={styles.balanceStatValue}>{formatMoney(expense)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.balanceTrend}>
          <MiniLine values={lastSeven.map((item) => item.net)} color={colors.primary} />
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <SectionTitle>Cash Flow</SectionTitle>
        <View style={styles.rangePill}>
          <Text style={styles.rangeText}>Last 7 days⌄</Text>
        </View>
      </View>

      <Card style={styles.chartCard}>
        <AnimatedAreaChart values={lastSeven.map((item) => item.net)} />
        <View style={styles.chartDays}>
          {lastSeven.map(({ day }) => (
            <Text key={day.toISOString()} style={styles.dayLabel}>{dateLabel(day)}</Text>
          ))}
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <SectionTitle>Top Categories</SectionTitle>
        <Pressable onPress={() => router.push("/transactions")}>
          <Text style={styles.viewAll}>View all</Text>
        </Pressable>
      </View>

      <View style={styles.categoryGrid}>
        {categoryTotals.length ? categoryTotals.slice(0, 4).map(([category, amount], index) => (
          <Pressable key={category} onPress={() => router.push("/transactions")} style={styles.categoryCard}>
            <View style={[styles.categoryIcon, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={{ color: CATEGORY_COLORS[index % CATEGORY_COLORS.length], fontSize: 15 }}>◈</Text>
            </View>
            <Text style={styles.categoryName} numberOfLines={1}>{category}</Text>
            <Text style={styles.categoryAmount}>{formatMoney(amount)}</Text>
            <View style={styles.categoryTrack}>
              <View style={[styles.categoryFill, { width: `${Math.max(8, (amount / maxCategory) * 100)}%`, backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }]} />
            </View>
          </Pressable>
        )) : (
          <Card style={{ width: "100%" }}><SmallText>No spending recorded yet.</SmallText></Card>
        )}
      </View>

      <View style={styles.sectionHeader}>
        <SectionTitle>Recent Activity</SectionTitle>
        <Pressable onPress={() => router.push("/transactions")}>
          <Text style={styles.filterIcon}>▽</Text>
        </Pressable>
      </View>

      <Card style={styles.activityCard}>
        {transactions.slice(0, 6).map((txn) => (
          <Pressable key={txn.id} onPress={() => router.push("/transactions")} style={styles.activityRow}>
            <View style={[styles.activityIcon, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.surfaceRaised }]}>
              <Text style={{ color: txn.type === "income" ? colors.primary : colors.muted, fontSize: 14 }}>
                {txn.type === "income" ? "↗" : "⌁"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle} numberOfLines={1}>{txn.description || txn.category}</Text>
              <Text style={styles.activityMeta}>{txn.category} • {txn.date}</Text>
            </View>
            <Text style={[styles.activityAmount, { color: txn.type === "income" ? colors.primary : colors.text }]}>
              {txn.type === "income" ? "+" : "-"}{formatMoney(txn.amount)}
            </Text>
          </Pressable>
        ))}
        {!transactions.length ? <EmptyActivity /> : null}
      </Card>

      <Card style={styles.savingsCard}>
        <View style={styles.rowBetween}>
          <View>
            <SmallText>Savings rate</SmallText>
            <Text style={styles.savingsValue}>{savingsRate.toFixed(1)}%</Text>
          </View>
          <Pill tone={savingsRate >= 40 ? "success" : "warning"}>
            {savingsRate >= 40 ? "On track" : "Needs attention"}
          </Pill>
        </View>
        <ProgressBar value={savingsRate} tone={savingsRate >= 40 ? "primary" : "warning"} />
      </Card>
    </Screen>
  );
}

function EmptyActivity() {
  return <View style={styles.empty}><SmallText>No recent activity.</SmallText></View>;
}

const styles = StyleSheet.create({
  balanceCard: {
    borderRadius: 16,
    padding: 17,
    gap: 14,
    overflow: "hidden",
  },
  balanceHeader: { gap: 4 },
  balanceLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  eyeIcon: { color: colors.subtle, fontSize: 13 },
  balanceValue: { color: colors.text, fontSize: 29, fontWeight: "900", letterSpacing: -0.6 },
  balanceStats: { flexDirection: "row", gap: 26 },
  balanceStat: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 110 },
  balanceStatIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  balanceStatValue: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 1 },
  balanceTrend: { marginHorizontal: -4, marginBottom: -7 },
  miniLine: { height: 48, width: "100%" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 2 },
  viewAll: { color: colors.primary, fontSize: 11, fontWeight: "700" },
  rangePill: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  rangeText: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  chartCard: { padding: 12, paddingBottom: 8, gap: 3 },
  chartWrap: { height: 126, width: "100%" },
  chartDays: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  dayLabel: { color: colors.subtle, fontSize: 9, fontWeight: "500" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  categoryCard: { width: "48%", minHeight: 108, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, justifyContent: "space-between" },
  categoryIcon: { width: 29, height: 29, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  categoryName: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 3 },
  categoryAmount: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: 2 },
  categoryTrack: { height: 4, borderRadius: 999, backgroundColor: colors.surfaceRaised, overflow: "hidden", marginTop: 7 },
  categoryFill: { height: "100%", borderRadius: 999 },
  activityCard: { paddingVertical: 3, overflow: "hidden" },
  activityRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  activityTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  activityMeta: { color: colors.subtle, fontSize: 9, marginTop: 2 },
  activityAmount: { fontSize: 12, fontWeight: "800" },
  filterIcon: { color: colors.muted, fontSize: 15 },
  empty: { minHeight: 80, alignItems: "center", justifyContent: "center" },
  savingsCard: { gap: 9 },
  savingsValue: { color: colors.text, fontSize: 25, fontWeight: "900", marginTop: 2 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
});
