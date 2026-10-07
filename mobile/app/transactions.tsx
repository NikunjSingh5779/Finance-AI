import { useCallback, useEffect, useMemo, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Button,
  Card,
  ChipRow,
  EmptyState,
  ErrorBanner,
  Header,
  Input,
  LoadingState,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { formatDate, useFinance } from "../src/AppContext";
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
    let [, first, second, year] = match;
    if (year.length === 2) year = (Number(year) > 50 ? "19" : "20") + year;
    return `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
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
  const { api, ready } = useFinance();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<"All" | "Income" | "Expense">("All");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setError("");
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
      const typeMatch = filter === "All" || txn.type === filter.toLowerCase();
      const searchMatch =
        !query ||
        txn.description.toLowerCase().includes(query) ||
        txn.category.toLowerCase().includes(query);
      return typeMatch && searchMatch;
    });
  }, [transactions, filter, search]);

  const openNew = () => {
    setEditingId(null);
    setType("expense");
    setAmount("");
    setDescription("");
    setCategory("");
    setDate(new Date().toISOString().slice(0, 10));
    setAccountId(accounts[0] ? String(accounts[0].id) : null);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (txn: Transaction) => {
    setEditingId(txn.id);
    setType(txn.type);
    setAmount(String(txn.amount));
    setDescription(txn.description);
    setCategory(txn.category);
    setDate(txn.date);
    setAccountId(txn.account_id ? String(txn.account_id) : accounts[0] ? String(accounts[0].id) : null);
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
  };

  const saveTransaction = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !category.trim() || !date.trim()) {
      setError("Enter a valid amount, category and date.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        type,
        amount: numericAmount,
        description: description.trim() || category.trim(),
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

      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (txn: Transaction) => {
    Alert.alert("Delete transaction", `Delete “${txn.description || txn.category}”?`, [
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
    ]);
  };

  const quickAdd = async () => {
    setEditingId(null);
    await saveTransaction();
  };

  const deleteAll = () => {
    Alert.alert(
      "Delete all transactions",
      `This will permanently delete ${transactions.length.toLocaleString("en-IN")} transactions.`,
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
      const headerMap = hasHeader ? Object.fromEntries(first.map((key, index) => [key, index])) : null;

      const rows = dataRows.map((values) => {
        const read = (key: string, fallback: number) =>
          headerMap ? String(values[headerMap[key] ?? -1] ?? "").trim() : String(values[fallback] ?? "").trim();

        const rawType = read("type", 0).toLowerCase();
        const rawAmount = read("amount", 1);
        const rawDescription = read("description", 2) || read("desc", 2);
        const rawCategory = read("category", 3) || read("cat", 3);
        const numericAmount = Math.abs(Number(rawAmount.replace(/,/g, "").replace(/₹/g, "")));

        if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !rawCategory) return null;

        return {
          type: rawType === "income" ? "income" as const : "expense" as const,
          amount: numericAmount,
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
      await load();
      Alert.alert("Import complete", `Imported ${result.imported} transaction(s).${result.failed ? ` ${result.failed} failed.` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction import failed.");
    }
  };

  const exportCSV = async () => {
    try {
      const csv = [
        ["id", "type", "amount", "description", "category", "date", "created", "account_id"],
        ...transactions.map((txn) => [txn.id, txn.type, txn.amount, txn.description, txn.category, txn.date, txn.created, txn.account_id ?? ""]),
      ].map((row) => row.map(csvEscape).join(",")).join("\n");

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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction export failed.");
    }
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <>
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
        <Header title="Transactions" />
        {error ? <ErrorBanner message={error} /> : null}

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryAction} onPress={openNew}><Text style={styles.primaryActionText}>+ Add transaction</Text></Pressable>
          <Pressable style={styles.secondaryAction} onPress={() => void importCSV()}><Text style={styles.actionText}>▣ Import CSV</Text></Pressable>
          <Pressable style={styles.secondaryAction} onPress={() => void exportCSV()}><Text style={styles.actionText}>↓ Export CSV</Text></Pressable>
          <Pressable style={styles.deleteAll} onPress={deleteAll}><Text style={styles.deleteAllText}>▣ Delete all</Text></Pressable>
        </View>

        <Input label="Search" value={search} onChangeText={setSearch} placeholder="Merchant or category..." />
        <ChipRow values={["All", "Income", "Expense"]} selected={filter} onSelect={(value) => setFilter(value as typeof filter)} />

        <Card style={styles.quickAddCard}>
          <View style={styles.quickHeader}>
            <View>
              <Text style={styles.quickTitle}>Quick Add</Text>
              <SmallText>Record a transaction without opening a new screen.</SmallText>
            </View>
            <Pressable onPress={openNew} style={styles.quickOpenButton}>
              <Text style={styles.quickOpenText}>Open form</Text>
            </Pressable>
          </View>

          <View style={styles.quickTypeRow}>
            <Pressable onPress={() => setType("expense")} style={[styles.quickType, type === "expense" && styles.quickTypeActive]}>
              <Text style={[styles.quickTypeText, type === "expense" && styles.quickTypeTextActive]}>Expense</Text>
            </Pressable>
            <Pressable onPress={() => setType("income")} style={[styles.quickType, type === "income" && styles.quickTypeActive]}>
              <Text style={[styles.quickTypeText, type === "income" && styles.quickTypeTextActive]}>Income</Text>
            </Pressable>
          </View>

          <View style={styles.quickRow}>
            <View style={{ flex: 1 }}>
              <Input label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="2500" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Category" value={category} onChangeText={setCategory} placeholder="Food" />
            </View>
          </View>

          <Input label="Description (e.g. Grocery shopping)" value={description} onChangeText={setDescription} placeholder="What was this for?" />

          <View style={styles.quickRow}>
            <View style={{ flex: 1 }}>
              <Input label="Date" value={date} onChangeText={setDate} placeholder="Today" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.quickAccountLabel}><Text style={styles.inputLikeLabel}>Account</Text></View>
              <ChipRow
                values={["None", ...accounts.map((account) => String(account.id) + ": " + account.name)]}
                selected={accountId ? String(accountId) + ": " + (accounts.find((a) => a.id === Number(accountId))?.name ?? "") : "None"}
                onSelect={(value) => setAccountId(value === "None" ? null : value.split(":")[0] ?? null)}
              />
            </View>
          </View>

          <Pressable onPress={() => void quickAdd()} style={styles.quickAddButton}>
            <Text style={styles.quickAddButtonText}>Add transaction</Text>
          </Pressable>
        </Card>

        <View style={styles.countRow}>
          <SectionTitle>{filtered.length.toLocaleString("en-IN")} shown</SectionTitle>
          <SmallText>{transactions.length.toLocaleString("en-IN")} total</SmallText>
        </View>

        {filtered.length === 0 ? (
          <Card><EmptyState message="No transactions match your filters." /></Card>
        ) : (
          filtered.map((txn) => (
            <Card key={txn.id} style={styles.transactionCard}>
              <View style={styles.transactionRow}>
                <View style={[styles.txnIcon, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.surfaceRaised }]}>
                  <Text style={{ color: txn.type === "income" ? colors.primary : colors.muted, fontSize: 15 }}>{txn.type === "income" ? "↗" : "⌁"}</Text>
                </View>
                <View style={styles.txnInfo}>
                  <Text style={styles.txnTitle} numberOfLines={1}>{txn.description || txn.category}</Text>
                  <SmallText>{txn.category} • {formatDate(txn.date)}</SmallText>
                </View>
                <View style={styles.txnRight}>
                  <Text style={[styles.txnAmount, { color: txn.type === "income" ? colors.primary : colors.text }]}>
                    {txn.type === "income" ? "+" : "-"}{formatMoney(txn.amount)}
                  </Text>
                  <View style={styles.rowButtons}>
                    <Pressable onPress={() => openEdit(txn)}><Text style={styles.editText}>Edit</Text></Pressable>
                    <Pressable onPress={() => remove(txn)}><Text style={styles.deleteText}>Delete</Text></Pressable>
                  </View>
                </View>
              </View>
            </Card>
          ))
        )}
      </Screen>

      <Modal visible={modalOpen} animationType="slide" transparent={false} onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalHeader}>
            <Pressable onPress={closeModal} disabled={saving}><Text style={styles.closeIcon}>×</Text></Pressable>
            <Text style={styles.modalTitle}>{editingId ? "Edit Transaction" : "Add Transaction"}</Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollForm
            type={type}
            setType={setType}
            amount={amount}
            setAmount={setAmount}
            description={description}
            setDescription={setDescription}
            category={category}
            setCategory={setCategory}
            date={date}
            setDate={setDate}
            accountId={accountId}
            setAccountId={setAccountId}
            accounts={accounts}
            error={error}
            editingId={editingId}
            saving={saving}
            onSave={() => void saveTransaction()}
          />
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function ScrollForm(props: {
  type: "income" | "expense";
  setType: (value: "income" | "expense") => void;
  amount: string;
  setAmount: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  accountId: string | null;
  setAccountId: (value: string | null) => void;
  accounts: Account[];
  error: string;
  editingId: number | null;
  saving: boolean;
  onSave: () => void;
}) {
  const {
    type, setType, amount, setAmount, description, setDescription,
    category, setCategory, date, setDate, accountId, setAccountId,
    accounts, error, editingId, saving, onSave,
  } = props;

  return (
    <Screen>
      {error ? <ErrorBanner message={error} /> : null}
      <View style={styles.modalTypeToggle}>
        <Pressable onPress={() => setType("income")} style={[styles.typeChoice, type === "income" && styles.typeSelected]}>
          <Text style={[styles.typeText, type === "income" && styles.typeTextSelected]}>Income</Text>
        </Pressable>
        <Pressable onPress={() => setType("expense")} style={[styles.typeChoice, type === "expense" && styles.typeSelected]}>
          <Text style={[styles.typeText, type === "expense" && styles.typeTextSelected]}>Expense</Text>
        </Pressable>
      </View>

      <View style={styles.bigAmount}>
        <Text style={styles.currency}>₹</Text>
        <Text style={styles.bigAmountText}>{amount || "0"}</Text>
      </View>

      <Input label="Description" value={description} onChangeText={setDescription} placeholder="What was this for?" />
      <Input label="Category" value={category} onChangeText={setCategory} placeholder="Select category" />

      <View style={styles.dateAccountRow}>
        <View style={{ flex: 1 }}>
          <Input label="Date" value={date} onChangeText={setDate} placeholder="Today" />
        </View>
        <View style={{ flex: 1 }}>
          <SmallText>Account</SmallText>
          <ChipRow
            values={["None", ...accounts.map((account) => String(account.id) + ": " + account.name)]}
            selected={accountId ? String(accountId) + ": " + (accounts.find((a) => a.id === Number(accountId))?.name ?? "") : "None"}
            onSelect={(value) => setAccountId(value === "None" ? null : value.split(":")[0] ?? null)}
          />
        </View>
      </View>

      <View style={styles.receiptRow}>
        <Text style={styles.receiptIcon}>⌕</Text>
        <Text style={styles.receiptText}>Attach receipt or image</Text>
      </View>

      <View style={{ height: 12 }} />
      <Button title={editingId ? "Save Transaction" : "Save Transaction"} onPress={onSave} loading={saving} />
    </Screen>
  );
}

function formatMoney(value: number) {
  return "₹" + Math.abs(Number(value) || 0).toLocaleString("en-IN");
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  primaryAction: { minHeight: 38, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  primaryActionText: { color: colors.background, fontSize: 11, fontWeight: "800" },
  secondaryAction: { minHeight: 38, paddingHorizontal: 11, borderRadius: 8, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  actionText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  deleteAll: { minHeight: 38, paddingHorizontal: 11, borderRadius: 8, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  deleteAllText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  countRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  quickAddCard: { gap: 10, padding: 13 },
  quickHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  quickTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  quickOpenButton: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, backgroundColor: colors.primary },
  quickOpenText: { color: colors.background, fontSize: 9, fontWeight: "800" },
  quickTypeRow: { flexDirection: "row", backgroundColor: colors.surfaceRaised, borderRadius: 9, padding: 3 },
  quickType: { flex: 1, minHeight: 31, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  quickTypeActive: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderStrong },
  quickTypeText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  quickTypeTextActive: { color: colors.text },
  quickRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  quickAccountLabel: { marginBottom: 4 },
  inputLikeLabel: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  quickAddButton: { minHeight: 38, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  quickAddButtonText: { color: colors.background, fontSize: 11, fontWeight: "900" },

  transactionCard: { paddingVertical: 11 },
  transactionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  txnIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txnInfo: { flex: 1, minWidth: 0 },
  txnTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  txnRight: { alignItems: "flex-end", gap: 5 },
  txnAmount: { fontSize: 12, fontWeight: "900" },
  rowButtons: { flexDirection: "row", gap: 8 },
  editText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  deleteText: { color: colors.danger, fontSize: 10, fontWeight: "700" },
  modalRoot: { flex: 1, backgroundColor: colors.background },
  modalHeader: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeIcon: { color: colors.text, fontSize: 32, fontWeight: "300" },
  modalTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  modalTypeToggle: { flexDirection: "row", padding: 3, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 17 },
  typeChoice: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  typeSelected: { backgroundColor: colors.surfaceRaised },
  typeText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  typeTextSelected: { color: colors.text },
  bigAmount: { minHeight: 92, flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 15 },
  currency: { color: colors.muted, fontSize: 34, marginRight: 5 },
  bigAmountText: { color: colors.text, fontSize: 54, fontWeight: "900" },
  dateAccountRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  receiptRow: { minHeight: 46, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, marginTop: 2 },
  receiptIcon: { color: colors.subtle, fontSize: 16 },
  receiptText: { color: colors.subtle, fontSize: 11, fontWeight: "600" },
});
