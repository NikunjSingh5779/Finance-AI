import { useCallback, useEffect, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Header,
  Input,
  LoadingState,
  Money,
  Pill,
  ProgressBar,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { useFinance } from "../src/AppContext";
import type { Budget, Summary } from "../src/types";
import { colors } from "../src/theme";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export default function BudgetsScreen() {
  const { api, ready } = useFinance();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setError("");
      const [budgetItems, summaryData] = await Promise.all([
        api.budgets(),
        api.summary("1m"),
      ]);
      setBudgets(budgetItems);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load budgets.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => budgets.map((budget) => {
    const spent = Number(summary?.category_totals?.[budget.category] ?? 0);
    const percentage = budget.limit_amt > 0 ? (spent / budget.limit_amt) * 100 : 0;
    return {
      ...budget,
      spent,
      percentage: Math.min(100, percentage),
      status: percentage >= 100 ? "Over" : percentage >= 80 ? "Near limit" : "On track",
    };
  }), [budgets, summary]);

  const totalBudget = budgets.reduce((sum, budget) => sum + budget.limit_amt, 0);
  const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
  const utilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  const createBudget = async () => {
    const numericLimit = Number(limit);
    if (!category.trim() || !Number.isFinite(numericLimit) || numericLimit <= 0) {
      setError("Enter a valid category and monthly limit.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.createBudget({
        category: category.trim(),
        limit_amt: numericLimit,
      });
      setCategory("");
      setLimit("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create budget.");
    } finally {
      setSaving(false);
    }
  };

  const deleteBudget = (budget: Budget) => {
    Alert.alert(
      "Delete budget",
      `Delete the ${budget.category} budget?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteBudget(budget.category);
              setBudgets((current) => current.filter((item) => item.category !== budget.category));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not delete budget.");
            }
          },
        },
      ],
    );
  };

  const importCSV = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;

      const text = await new File(asset.uri).text();
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) {
        setError("CSV has no data rows.");
        return;
      }

      const parsed = lines.map(parseCSVLine);
      const first = parsed[0].map((value) => value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
      const hasHeader = first[0]?.includes("category") || first[1]?.includes("limit");
      const rowsToImport = (hasHeader ? parsed.slice(1) : parsed)
        .map((values) => ({
          category: String(values[0] ?? "").trim(),
          limit: Number(String(values[1] ?? "").replace(/,/g, "").replace(/₹/g, "").trim()),
        }))
        .filter((row) => row.category && Number.isFinite(row.limit) && row.limit > 0);

      if (!rowsToImport.length) {
        setError("No valid budget rows found.");
        return;
      }

      let imported = 0;
      for (const row of rowsToImport) {
        try {
          await api.createBudget({ category: row.category, limit_amt: row.limit });
          imported += 1;
        } catch {
          // Continue importing valid rows even when a category already exists.
        }
      }

      setError("");
      await load();
      Alert.alert("Import complete", `Imported ${imported} budget(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Budget import failed.");
    }
  };

  const exportCSV = async () => {
    try {
      const csv = [
        ["category", "limit_amt"],
        ...budgets.map((budget) => [budget.category, budget.limit_amt]),
      ].map((row) => row.map(csvEscape).join(",")).join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "financeai-budgets.csv";
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }

      const file = new File(Paths.cache, "financeai-budgets.csv");
      file.write(csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/csv",
          dialogTitle: "Export FinanceAI budgets",
          UTI: "public.comma-separated-values-text",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Budget export failed.");
    }
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
      <Header title="Budgets" subtitle="Plan, track and control monthly spending." />
      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.summaryGrid}>
        <Card style={styles.summaryCard}>
          <SmallText>Total budget</SmallText>
          <Text style={styles.bigValue}>{money(totalBudget)}<Text style={styles.unit}> / mo</Text></Text>
          <ProgressBar value={utilization} tone={utilization >= 100 ? "danger" : utilization >= 80 ? "warning" : "primary"} />
        </Card>
        <Card style={styles.summaryCard}>
          <SmallText>Spent this month</SmallText>
          <Text style={[styles.bigValue, { color: utilization >= 100 ? colors.danger : colors.text }]}>{money(totalSpent)}</Text>
          <SmallText>{utilization.toFixed(0)}% of total budget</SmallText>
        </Card>
      </View>

      {utilization >= 80 ? (
        <Card style={styles.warningCard}>
          <View style={styles.warningIcon}><Text>!</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.warningTitle}>{utilization >= 100 ? "Over budget warning" : "Budget warning"}</Text>
            <SmallText>
              {utilization >= 100
                ? "Your total monthly spending has reached the budget limit."
                : "You're approaching your total monthly budget limit."}
            </SmallText>
          </View>
        </Card>
      ) : null}

      <View style={styles.headerRow}>
        <View>
          <SectionTitle>Categories</SectionTitle>
          <SmallText>{budgets.length} active budget{budgets.length === 1 ? "" : "s"}</SmallText>
        </View>
        <View style={styles.actionRow}>
          <Button title="Import" onPress={() => void importCSV()} kind="secondary" />
          <Button title="Export" onPress={() => void exportCSV()} kind="secondary" />
          <Button title={showForm ? "Close" : "+ Budget"} onPress={() => setShowForm((value) => !value)} />
        </View>
      </View>

      {showForm ? (
        <Card>
          <SectionTitle>New budget</SectionTitle>
          <Input label="Category" value={category} onChangeText={setCategory} placeholder="Food & Dining" />
          <Input label="Monthly limit (₹)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="15000" />
          <Button title="Save budget" onPress={() => void createBudget()} loading={saving} />
        </Card>
      ) : null}

      {!rows.length ? (
        <Card><EmptyState message="No budgets configured yet." /></Card>
      ) : (
        rows.map((row) => (
          <Card key={row.id} style={styles.categoryCard}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.categoryTitle}>{row.category}</Text>
                <SmallText>Spent {money(row.spent)} of {money(row.limit_amt)}</SmallText>
              </View>
              <View style={styles.amountSide}>
                <Text style={[styles.percent, { color: row.percentage >= 100 ? colors.danger : row.percentage >= 80 ? colors.warning : colors.text }]}>{row.percentage.toFixed(0)}%</Text>
                <Pill tone={row.percentage >= 100 ? "danger" : row.percentage >= 80 ? "warning" : "success"}>{row.status}</Pill>
              </View>
            </View>
            <ProgressBar value={row.percentage} tone={row.percentage >= 100 ? "danger" : row.percentage >= 80 ? "warning" : "primary"} />
            <Pressable onPress={() => deleteBudget(row)}><Text style={styles.deleteText}>Delete</Text></Pressable>
          </Card>
        ))
      )}
    </Screen>
  );
}

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

const styles = StyleSheet.create({
  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryCard: { flex: 1, minWidth: 0, minHeight: 112, gap: 8 },
  bigValue: { color: colors.text, fontSize: 25, fontWeight: "900" },
  unit: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  warningCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.dangerSoft, borderColor: "rgba(239,68,68,.25)" },
  warningIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: "rgba(239,68,68,.16)", alignItems: "center", justifyContent: "center" },
  warningTitle: { color: colors.danger, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  actionRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },
  categoryCard: { gap: 10 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  categoryTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  amountSide: { alignItems: "flex-end", gap: 5 },
  percent: { fontSize: 15, fontWeight: "900" },
  deleteText: { color: colors.danger, fontSize: 11, fontWeight: "800", alignSelf: "flex-end" },
});
