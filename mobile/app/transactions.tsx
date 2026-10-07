import { useCallback, useEffect, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  ChipRow,
  EmptyState,
  ErrorBanner,
  Header,
  Input,
  LoadingState,
  Money,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { currentMonth, formatDate, useFinance } from "../src/AppContext";
import type { Account, Transaction } from "../src/types";
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

function normalizeDate(value: string) {
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) {
    let [, dayOrMonth, monthOrDay, year] = match;
    if (year.length === 2) year = (Number(year) > 50 ? "19" : "20") + year;
    return `${year}-${monthOrDay.padStart(2, "0")}-${dayOrMonth.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export default function TransactionsScreen() {
  const { api, ready, apiBaseUrl } = useFinance();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<"All" | "Income" | "Expense">("All");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(currentMonth() + "-01");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    setError("");
    try {
      const [items, accountItems] = await Promise.all([
        api.transactions(5000),
        api.accounts(),
      ]);
      setTransactions(items);
      setAccounts(accountItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load transactions.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((txn) => {
      const matchesType = filter === "All" || txn.type === filter.toLowerCase();
      const matchesSearch =
        !query ||
        txn.description.toLowerCase().includes(query) ||
        txn.category.toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [transactions, filter, search]);

  const resetForm = () => {
    setEditingId(null);
    setType("expense");
    setAmount("");
    setDescription("");
    setCategory("");
    setDate(currentMonth() + "-01");
    setAccountId(null);
    setShowForm(false);
  };

  const openNew = () => {
    setEditingId(null);
    setType("expense");
    setAmount("");
    setDescription("");
    setCategory("");
    setDate(currentMonth() + "-01");
    setAccountId(null);
    setError("");
    setShowForm(true);
  };

  const openEdit = (txn: Transaction) => {
    setEditingId(txn.id);
    setType(txn.type);
    setAmount(String(txn.amount));
    setDescription(txn.description);
    setCategory(txn.category);
    setDate(txn.date);
    setAccountId(txn.account_id ? String(txn.account_id) : null);
    setError("");
    setShowForm(true);
  };

  const saveTransaction = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !description.trim() || !category.trim() || !date.trim()) {
      setError("Enter a positive amount, description, category and date.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        type,
        amount: numericAmount,
        description: description.trim(),
        category: category.trim(),
        date: normalizeDate(date),
        account_id: accountId ? Number(accountId) : null,
      };

      if (editingId) {
        const updated = await api.updateTransaction(editingId, payload);
        setTransactions((current) => current.map((item) => item.id === editingId ? updated : item));
      } else {
        const created = await api.createTransaction(payload);
        setTransactions((current) => [created, ...current]);
      }

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (txn: Transaction) => {
    Alert.alert(
      "Delete transaction",
      `Delete “${txn.description || txn.category}”?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteTransaction(txn.id);
              setTransactions((current) => current.filter((item) => item.id !== txn.id));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not delete transaction.");
            }
          },
        },
      ],
    );
  };

  const deleteAll = () => {
    Alert.alert(
      "Delete all transactions",
      `This will permanently delete all ${transactions.length.toLocaleString("en-IN")} transactions.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteAllTransactions();
              setTransactions([]);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not delete all transactions.");
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

      const csvText = await new File(asset.uri).text();
      const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) {
        setError("CSV has no data rows.");
        return;
      }

      const parsed = lines.map(parseCSVLine);
      const first = parsed[0].map((value) => value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
      const hasHeader = first.includes("type") || first.includes("amount") || first.includes("description");
      const dataRows = hasHeader ? parsed.slice(1) : parsed;
      const headerMap = hasHeader
        ? Object.fromEntries(first.map((key, index) => [key, index]))
        : null;

      const rows = dataRows.map((values) => {
        const read = (key: string, fallbackIndex: number) =>
          headerMap ? String(values[headerMap[key] ?? -1] ?? "").trim() : String(values[fallbackIndex] ?? "").trim();

        const rawType = read("type", 0).toLowerCase();
        const rawAmount = read("amount", 1);
        const rawDescription = read("description", 2) || read("desc", 2);
        const rawCategory = read("category", 3) || read("cat", 3);

        const parsedAmount = Math.abs(Number(rawAmount.replace(/,/g, "").replace(/₹/g, "")));
        if (
          !Number.isFinite(parsedAmount) ||
          parsedAmount <= 0 ||
          !rawCategory
        ) {
          return null;
        }

        return {
          type: rawType === "income" ? "income" as const : "expense" as const,
          amount: parsedAmount,
          description: rawDescription || rawCategory,
          category: rawCategory,
          date: normalizeDate(read("date", 4)),
          account_id: null,
        };
      }).filter((row): row is NonNullable<typeof row> => row !== null);

      if (!rows.length) {
        setError("No valid transaction rows found.");
        return;
      }

      const result = await api.importTransactions(rows);
      setError("");
      await load();
      Alert.alert("Import complete", `Imported ${result.imported} transaction(s).${result.failed ? ` ${result.failed} row(s) failed.` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction import failed.");
    }
  };

  const exportCSV = async () => {
    try {
      const rows = [
        ["id", "type", "amount", "description", "category", "date", "created", "account_id"],
        ...transactions.map((txn) => [
          txn.id, txn.type, txn.amount, txn.description, txn.category, txn.date, txn.created, txn.account_id ?? "",
        ]),
      ];
      const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "financeai-transactions.csv";
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }

      const file = new File(Paths.cache, "financeai-transactions.csv");
      file.write(csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/csv",
          dialogTitle: "Export FinanceAI transactions",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Export ready", file.uri);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction export failed.");
    }
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
      <Header title="Transactions" subtitle="Track every inflow and outflow." />
      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.headerActions}>
        <ActionButton title="+ Add transaction" onPress={openNew} primary />
        <ActionButton title="📁 Import CSV" onPress={() => void importCSV()} />
        <ActionButton title="⬇ Export CSV" onPress={() => void exportCSV()} />
        <ActionButton title="🗑 Delete all" onPress={deleteAll} danger />
      </View>

      <Card style={styles.searchCard}>
        <Input label="Search transactions" value={search} onChangeText={setSearch} placeholder="Merchant or category…" />
      </Card>

      <View style={styles.sectionRow}>
        <SectionTitle>{filtered.length.toLocaleString("en-IN")} transactions</SectionTitle>
        <SmallText>{transactions.length.toLocaleString("en-IN")} total</SmallText>
      </View>

      <ChipRow values={["All", "Income", "Expense"]} selected={filter} onSelect={(value) => setFilter(value as typeof filter)} />

      {showForm ? (
        <Card style={styles.formCard}>
          <View style={styles.sectionRow}>
            <SectionTitle>{editingId ? "Edit transaction" : "New transaction"}</SectionTitle>
            <Pressable onPress={resetForm}><Text style={styles.link}>Close</Text></Pressable>
          </View>

          <ChipRow
            values={["expense", "income"]}
            selected={type}
            onSelect={(value) => setType(value as "income" | "expense")}
          />
          <Input label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="2500" />
          <Input label="Description" value={description} onChangeText={setDescription} placeholder="Groceries" />
          <Input label="Category" value={category} onChangeText={setCategory} placeholder="Food" />
          <Input label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" />
          <SmallText>Account (optional)</SmallText>
          <ChipRow
            values={["None", ...accounts.map((account) => account.id + ": " + account.name)]}
            selected={
              accountId
                ? accountId + ": " + (accounts.find((account) => account.id === Number(accountId))?.name ?? "")
                : "None"
            }
            onSelect={(value) => {
              if (value === "None") {
                setAccountId(null);
                return;
              }
              setAccountId(value.split(":")[0] ?? null);
            }}
          />
          <Button title={editingId ? "Save changes" : "Save transaction"} onPress={() => void saveTransaction()} loading={saving} />
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <Card><EmptyState message="No transactions match your filters." /></Card>
      ) : (
        filtered.map((txn) => (
          <Card key={txn.id} style={styles.transactionCard}>
            <View style={styles.transactionMain}>
              <View style={[styles.iconBox, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.dangerSoft }]}>
                <Text style={{ color: txn.type === "income" ? colors.primary : colors.danger, fontSize: 16 }}>
                  {txn.type === "income" ? "↗" : "↘"}
                </Text>
              </View>
              <View style={styles.transactionInfo}>
                <Text style={styles.titleText} numberOfLines={1}>{txn.description || txn.category}</Text>
                <SmallText>{txn.category} · {formatDate(txn.date)}</SmallText>
                {txn.account_id ? <SmallText>Account #{txn.account_id}</SmallText> : null}
              </View>
              <View style={styles.amountColumn}>
                <Text style={[styles.amount, { color: txn.type === "income" ? colors.primary : colors.danger }]}>
                  {txn.type === "income" ? "+" : "-"}₹{txn.amount.toLocaleString("en-IN")}
                </Text>
                <View style={styles.rowActions}>
                  <Pressable onPress={() => openEdit(txn)} style={styles.smallButton}><Text style={styles.smallButtonText}>Edit</Text></Pressable>
                  <Pressable onPress={() => remove(txn)} style={[styles.smallButton, styles.deleteButton]}><Text style={styles.deleteText}>Delete</Text></Pressable>
                </View>
              </View>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

function ActionButton({
  title,
  onPress,
  primary = false,
  danger = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && styles.actionPrimary,
        danger && styles.actionDanger,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.actionText, primary && styles.actionPrimaryText, danger && styles.actionDangerText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionDanger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  actionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  actionPrimaryText: {
    color: colors.background,
  },
  actionDangerText: {
    color: "#fff",
  },
  searchCard: {
    paddingBottom: 10,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  formCard: {
    gap: 10,
  },
  transactionCard: {
    paddingVertical: 12,
  },
  transactionMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  transactionInfo: {
    flex: 1,
    minWidth: 0,
  },
  titleText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  amountColumn: {
    alignItems: "flex-end",
    gap: 7,
  },
  amount: {
    fontSize: 13,
    fontWeight: "800",
  },
  rowActions: {
    flexDirection: "row",
    gap: 6,
  },
  smallButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallButtonText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "700",
  },
  deleteButton: {
    backgroundColor: colors.dangerSoft,
    borderColor: "rgba(239,68,68,0.3)",
  },
  deleteText: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: "700",
  },
  link: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },
});
