import { useCallback, useEffect, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import {
  Card,
  EmptyState,
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
import type { InsightsDashboard } from "../src/types";
import { colors } from "../src/theme";

export default function InsightsScreen() {
  const { api, ready } = useFinance();
  const [data, setData] = useState<InsightsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    setError("");
    try {
      setData(await api.insightsDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load insights.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <Screen><LoadingState /></Screen>;

  const health = data?.health;

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}>
      <Header title="Financial Insights" subtitle="Explainable signals from your recorded finances." />
      {error ? <ErrorBanner message={error} /> : null}

      {health ? (
        <Card>
          <View style={styles.scoreRow}>
            <View>
              <SmallText>Financial Health Score</SmallText>
              <Text style={styles.score}>{health.score}</Text>
              <Pill tone={health.score >= 70 ? "success" : health.score >= 55 ? "warning" : "danger"}>
                {health.grade}
              </Pill>
            </View>
            <View style={{ width: 140, gap: 8 }}>
              <ProgressBar value={health.score} />
              <SmallText>{health.metrics.savings_rate.toFixed(1)}% savings rate</SmallText>
              <SmallText>{health.metrics.months_of_buffer.toFixed(1)} months cash buffer</SmallText>
            </View>
          </View>

          <SectionTitle>Score components</SectionTitle>
          {[
            ["Savings", health.components.savings, 30],
            ["Budgeting", health.components.budgeting, 25],
            ["Consistency", health.components.expense_consistency, 20],
            ["Cash buffer", health.components.cash_buffer, 25],
          ].map(([label, value, max]) => (
            <View key={String(label)} style={{ gap: 5 }}>
              <View style={styles.rowBetween}>
                <SmallText>{label}</SmallText>
                <SmallText>{Number(value).toFixed(1)}/{max}</SmallText>
              </View>
              <ProgressBar value={Number(value)} max={Number(max)} />
            </View>
          ))}

          {health.actions.length ? (
            <>
              <SectionTitle>Recommended actions</SectionTitle>
              {health.actions.map((action) => (
                <View key={action} style={styles.insightRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.body}>{action}</Text>
                </View>
              ))}
            </>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>Recurring expenses</SectionTitle>
      {data?.recurring.length ? data.recurring.map((item) => (
        <Card key={item.description + "-" + item.category}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.titleText}>{item.description}</Text>
              <SmallText>{item.category} · {item.occurrences} occurrences</SmallText>
            </View>
            <Money value={item.estimated_monthly_cost} size={17} />
          </View>
          <SmallText>
            Average ₹{item.average_amount.toLocaleString("en-IN")} · last seen {item.last_date}
          </SmallText>
        </Card>
      )) : <Card><EmptyState message="No recurring monthly pattern detected yet." /></Card>}

      <SectionTitle>Unusual spending</SectionTitle>
      {data?.anomalies.length ? data.anomalies.map((item) => (
        <Card key={String(item.transaction_id) + "-" + item.date}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.titleText}>{item.description}</Text>
              <SmallText>{item.category} · {item.date}</SmallText>
            </View>
            <Pill tone={item.severity === "high" ? "danger" : "warning"}>{item.severity}</Pill>
          </View>
          <Money value={item.amount} size={22} />
          <SmallText>
            {item.multiple_of_average.toFixed(1)}× category average · z-score {item.z_score.toFixed(2)}
          </SmallText>
        </Card>
      )) : <Card><EmptyState message="No unusual-spending signal detected." /></Card>}

      <SmallText>
        These are analytical estimates from tracked data, not guaranteed predictions or investment advice.
      </SmallText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  score: {
    color: colors.text,
    fontSize: 58,
    lineHeight: 62,
    fontWeight: "900",
    marginVertical: 4,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  insightRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  bullet: {
    color: colors.primary,
    fontSize: 20,
    lineHeight: 18,
  },
  body: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  titleText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 14,
  },
});
