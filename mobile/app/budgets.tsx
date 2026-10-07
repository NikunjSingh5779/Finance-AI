import { useCallback, useEffect, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Header,
  Input,
  LoadingState,
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
      const [items, summaryData] = await Promise.all([
        api.budgets(),
        api.summary("1m"),
      ]);
      setBudgets(items);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load budgets.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () =>
      budgets.map((budget) => {
        const spent = Number(summary?.category_totals?.[budget.category] ?? 0);
        const rawPercent = budget.limit_amt > 0 ? (spent / budget.limit_amt) * 100 : 0;
        return {
          ...budget,
          spent,
          rawPercent,
          percent: Math.min(100, rawPercent),
          status: rawPercent >= 100 ? "Over" : rawPercent >= 80 ? "Warning" : "Healthy",
        };
      }),
    [budgets, summary],
  );

  const totalBudget = budgets.reduce((sum, item) => sum + item.limit_amt, 0);
  const totalSpent = rows.reduce((sum, item) => sum + item.spent, 0);
  const utilization = totalBudget ? (totalSpent / totalBudget) * 100 : 0;

  const createBudget = async () => {
    const amount = Number(limit);
    if (!category.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid category and monthly limit.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.createBudget({ category: category.trim(), limit_amt: amount });
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
    Alert.alert("Delete budget", `Delete the ${budget.category} budget?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteBudget(budget.category);
            setBudgets((items) => items.filter((item) => item.category !== budget.category));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete budget.");
          }
        },
      },
    ]);
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

      const raw = await new File(asset.uri).text();
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) {
        setError("CSV has no data rows.");
        return;
      }

      const parsed = lines.map(parseCSVLine);
      const header = parsed[0].map((value) => value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
      const hasHeader = header.includes("category") || header.includes("limit") || header.includes("limitamt");
      const data = hasHeader ? parsed.slice(1) : parsed;
      const map = hasHeader ? Object.fromEntries(header.map((name, index) => [name, index])) : null;

      const importedRows = data
        .map((values) => {
          const read = (key: string, fallback: number) =>
            map ? String(values[map[key] ?? -1] ?? "").trim() : String(values[fallback] ?? "").trim();
          const categoryValue = read("category", 0);
          const limitValue = Number(read("limit", 1) || read("limitamt", 1).replace(/,/g, "").replace(/₹/g, ""));
          if (!categoryValue || !Number.isFinite(limitValue) || limitValue <= 0) return null;
          return { category: categoryValue, limit_amt: limitValue };
        })
        .filter((row): row is { category: string; limit_amt: number } => Boolean(row));

      if (!importedRows.length) {
        setError("No valid budget rows found. Use category,limit_amt.");
        return;
      }

      let imported = 0;
      for (const row of importedRows) {
        try {
          await api.createBudget(row);
          imported += 1;
        } catch {
          // Keep importing the valid rows that remain.
        }
      }

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
        ...budgets.map((item) => [item.category, item.limit_amt]),
      ].map((row) => row.map(csvEscape).join(",")).join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "financeai-budgets.csv";
        link.click();
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

  const ringRadius = 25;
  const circumference = 2 * Math.PI * ringRadius;
  const dash = Math.min(100, Math.max(0, utilization)) / 100 * circumference;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
      <Header title="Budgets" action="plus" onAction={() => setShowForm((value) => !value)} />
      {error ? <ErrorBanner message={error} /> : null}

      <Card style={styles.totalCard}>
        <View style={styles.totalText}>
          <SmallText>TOTAL BUDGET</SmallText>
          <Text style={styles.totalValue}>{money(totalBudget)}<Text style={styles.perMonth}> / mo</Text></Text>
          <SmallText>{money(totalSpent)} spent this month</SmallText>
        </View>
        <View style={styles.ringWrap}>
          <Svg width={64} height={64} viewBox="0 0 64 64">
            <Circle cx="32" cy="32" r={ringRadius} stroke={colors.surfaceRaised} strokeWidth="5" fill="none" />
            <Circle
              cx="32"
              cy="32"
              r={ringRadius}
              stroke={utilization >= 100 ? colors.danger : colors.primary}
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              rotation="-90"
              origin="32,32"
            />
          </Svg>
          <Text style={styles.ringText}>{utilization.toFixed(0)}%</Text>
        </View>
      </Card>

      {utilization >= 80 ? (
        <Card style={styles.warningCard}>
          <View style={styles.warningIcon}><Text>!</Text></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.warningTitle}>OVER BUDGET WARNING</Text>
            <SmallText>
              {utilization >= 100
                ? "Your spending has reached or exceeded your total monthly budget."
                : "You're getting close to your monthly budget limit."}
            </SmallText>
          </View>
        </Card>
      ) : null}

      <View style={styles.sectionHeader}>
        <View>
          <SectionTitle>Categories</SectionTitle>
          <SmallText>This month</SmallText>
        </View>
        <View style={styles.headerTools}>
          <Pressable onPress={() => void importCSV()} style={styles.toolButton}><Text style={styles.toolText}>Import</Text></Pressable>
          <Pressable onPress={() => void exportCSV()} style={styles.toolButton}><Text style={styles.toolText}>Export</Text></Pressable>
        </View>
      </View>

      {showForm ? (
        <Card style={styles.formCard}>
          <SectionTitle>New budget</SectionTitle>
          <Input label="Category" value={category} onChangeText={setCategory} placeholder="Food & Dining" />
          <Input label="Monthly limit (₹)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="15000" />
          <Button title="Save budget" onPress={() => void createBudget()} loading={saving} />
        </Card>
      ) : null}

      {!rows.length ? (
        <Card><EmptyState message="No budgets configured yet." /></Card>
      ) : (
        rows.map((row, index) => (
          <Card key={row.id} style={styles.categoryCard}>
            <View style={styles.categoryTop}>
              <View style={[styles.categoryIcon, { backgroundColor: ["#14243b", "#2b2414", "#28183b", "#18311f"][index % 4] }]}>
                <Text style={{ color: [colors.info, colors.warning, "#a855f7", colors.primary][index % 4], fontSize: 14 }}>◈</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.categoryTitle}>{row.category}</Text>
                  <Text style={[styles.percent, { color: row.rawPercent >= 100 ? colors.danger : row.rawPercent >= 80 ? colors.warning : colors.text }]}>{row.rawPercent.toFixed(0)}%</Text>
                </View>
                <SmallText>Spent {money(row.spent)} of {money(row.limit_amt)}</SmallText>
              </View>
            </View>

            <ProgressBar value={row.rawPercent} tone={row.rawPercent >= 100 ? "danger" : row.rawPercent >= 80 ? "warning" : "primary"} />

            <View style={styles.rowBetween}>
              <Pill tone={row.rawPercent >= 100 ? "danger" : row.rawPercent >= 80 ? "warning" : "success"}>{row.status}</Pill>
              <Pressable onPress={() => deleteBudget(row)}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

function money(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

const styles = StyleSheet.create({
  totalCard: { minHeight: 112, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalText: { flex: 1, gap: 4 },
  totalValue: { color: colors.text, fontSize: 27, fontWeight: "900" },
  perMonth: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  ringWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  ringText: { position: "absolute", color: colors.text, fontSize: 10, fontWeight: "900" },
  warningCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.dangerSoft, borderColor: "rgba(239,68,68,.25)" },
  warningIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(239,68,68,.14)", alignItems: "center", justifyContent: "center" },
  warningTitle: { color: colors.danger, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerTools: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolButton: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  toolText: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  plusButton: { width: 32, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  plusText: { color: colors.text, fontSize: 22, lineHeight: 25 },
  formCard: { gap: 10 },
  categoryCard: { gap: 10 },
  categoryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  categoryIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  categoryTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  percent: { fontSize: 13, fontWeight: "900" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  deleteText: { color: colors.danger, fontSize: 10, fontWeight: "800" },
});
