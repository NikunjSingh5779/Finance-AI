import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
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

export default function TransactionsScreen() {
  const { api, ready } = useFinance();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
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
        api.transactions(500),
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

  useEffect(() => {
    void load();
  }, [load]);

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

  const addTransaction = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !description.trim() || !category.trim()) {
      setError("Enter a positive amount, description and category.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createTransaction({
        type,
        amount: numericAmount,
        description: description.trim(),
        category: category.trim(),
        date,
        ...(accountId ? { account_id: Number(accountId) } : {}),
      });
      setAmount("");
      setDescription("");
      setCategory("");
      setDate(currentMonth() + "-01");
      setAccountId(null);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (txn: Transaction) => {
    Alert.alert(
      "Delete transaction",
      "Delete " + txn.description + " for ₹" + txn.amount.toLocaleString("en-IN") + "?",
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

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <Header title="Transactions" subtitle="Track every inflow and outflow." />
      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.actionRow}>
        <View style={{ flex: 1 }}>
          <Input label="Search" value={search} onChangeText={setSearch} placeholder="Merchant or category…" />
        </View>
        <Button
          title={showForm ? "Close" : "+ Add"}
          onPress={() => setShowForm((value) => !value)}
          kind={showForm ? "secondary" : "primary"}
        />
      </View>

      <ChipRow values={["All", "Income", "Expense"]} selected={filter} onSelect={setFilter} />

      {showForm ? (
        <Card>
          <SectionTitle>New transaction</SectionTitle>
          <ChipRow values={["expense", "income"]} selected={type} onSelect={(value) => setType(value as "income" | "expense")} />
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
              const first = value.split(":")[0];
              setAccountId(first ?? null);
            }}
          />
          <Button title="Save transaction" onPress={() => void addTransaction()} loading={saving} />
        </Card>
      ) : null}

      <View style={styles.rowBetween}>
        <SectionTitle>{filtered.length} shown</SectionTitle>
        <SmallText>Loaded up to 500</SmallText>
      </View>

      {filtered.length === 0 ? (
        <Card><EmptyState message="No transactions match your filters." /></Card>
      ) : (
        filtered.map((txn) => (
          <Pressable key={txn.id} onLongPress={() => remove(txn)}>
            <Card style={styles.transactionCard}>
              <View style={styles.rowBetween}>
                <View style={styles.leftRow}>
                  <View style={[styles.iconBox, { backgroundColor: txn.type === "income" ? colors.primarySoft : colors.dangerSoft }]}>
                    <Text style={{ color: txn.type === "income" ? colors.primary : colors.danger, fontSize: 17 }}>
                      {txn.type === "income" ? "↗" : "↘"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.titleText} numberOfLines={1}>{txn.description}</Text>
                    <SmallText>{txn.category} · {formatDate(txn.date)}</SmallText>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Money value={txn.type === "income" ? txn.amount : -txn.amount} size={16} />
                  <SmallText>Hold to delete</SmallText>
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  transactionCard: {
    paddingVertical: 13,
  },
  leftRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
});
