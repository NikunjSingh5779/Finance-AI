import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFinance } from "../src/AppContext";
import { Button, Card, ChipRow, EmptyState, ErrorBanner, Header, Input, LoadingState, Pill, Screen, SectionTitle, SmallText } from "../src/components";
import { Icon } from "../src/icons";
import type { RecurringItem } from "../src/types";
import { colors } from "../src/theme";

function localDateInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function dueLabel(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(value + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "Overdue by " + Math.abs(days) + " day(s)";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return "Due in " + days + " days";
}

function money(value: number) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function RecurringScreen() {
  const { api, ready } = useFinance();
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [amountValue, setAmountValue] = useState("");
  const [kind, setKind] = useState("Expense");
  const [category, setCategory] = useState("Subscriptions");
  const [frequency, setFrequency] = useState("Monthly");
  const [nextDueDate, setNextDueDate] = useState(localDateInput());

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setError("");
      setItems(await api.recurring());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load recurring schedules.");
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => { void load(); }, [load]);

  const activeItems = useMemo(() => items.filter(item => item.is_active), [items]);
  const totalMonthlyExpense = useMemo(() => activeItems.reduce((sum, item) => {
    if (item.type !== "expense") return sum;
    const monthly = item.frequency === "weekly"
      ? item.amount * 52 / 12
      : item.frequency === "yearly"
        ? item.amount / 12
        : item.amount;
    return sum + monthly;
  }, 0), [activeItems]);

  const resetForm = () => {
    setName("");
    setAmountValue("");
    setKind("Expense");
    setCategory("Subscriptions");
    setFrequency("Monthly");
    setNextDueDate(localDateInput());
    setFormOpen(false);
  };

  const createItem = async () => {
    const parsedAmount = Number(amountValue);
    if (!name.trim() || !category.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || !/^\\d{4}-\\d{2}-\\d{2}$/.test(nextDueDate)) {
      setError("Enter a name, valid amount, category and date in YYYY-MM-DD format.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createRecurring({
        name: name.trim(),
        amount: parsedAmount,
        type: kind.toLowerCase() as "income" | "expense",
        category: category.trim(),
        frequency: frequency.toLowerCase() as "weekly" | "monthly" | "yearly",
        next_due_date: nextDueDate,
      });
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create schedule.");
    } finally {
      setSaving(false);
    }
  };

  const recordItem = (item: RecurringItem) => {
    Alert.alert(
      "Record recurring payment",
      "Create one " + (item.type === "income" ? "income" : "expense") + " transaction for " + item.name + " on " + formatDate(item.next_due_date) + "?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Record",
          onPress: async () => {
            try {
              await api.recordRecurring(item.id, item.next_due_date);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not record payment.");
            }
          },
        },
      ],
    );
  };

  const toggleItem = async (item: RecurringItem) => {
    try {
      await api.updateRecurring(item.id, { is_active: !item.is_active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update schedule.");
    }
  };

  const deleteItem = (item: RecurringItem) => {
    Alert.alert(
      "Delete schedule",
      "Delete " + item.name + "? Schedules with payment history must be paused instead.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteRecurring(item.id);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not delete schedule.");
            }
          },
        },
      ],
    );
  };

  if (loading) return <Screen><LoadingState /></Screen>;

  return (
    <>
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
        <Header title="Recurring payments" action="plus" onAction={() => setFormOpen(true)} />
        {error ? <ErrorBanner message={error} /> : null}

        <View style={styles.metricRow}>
          <Card style={styles.metricCard}>
            <SmallText>ACTIVE SCHEDULES</SmallText>
            <Text style={styles.metricValue}>{activeItems.length}</Text>
          </Card>
          <Card style={styles.metricCard}>
            <SmallText>EST. MONTHLY EXPENSES</SmallText>
            <Text style={styles.metricValue}>{money(totalMonthlyExpense)}</Text>
          </Card>
        </View>

        <View style={styles.sectionHeader}>
          <SectionTitle>Upcoming and paused</SectionTitle>
          <Button title="Add schedule" onPress={() => setFormOpen(true)} />
        </View>

        {items.length ? items.map(item => (
          <Card key={item.id} style={styles.itemCard}>
            <View style={styles.itemTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <SmallText>{item.category} · {item.frequency}</SmallText>
              </View>
              <Text style={[styles.itemAmount, item.type === "income" && { color: colors.primary }]}>
                {item.type === "income" ? "+" : "−"}{money(item.amount)}
              </Text>
            </View>
            <View style={styles.dueRow}>
              <Pill tone={!item.is_active ? "neutral" : dueLabel(item.next_due_date).startsWith("Overdue") ? "danger" : "warning"}>
                {item.is_active ? dueLabel(item.next_due_date) : "Paused"}
              </Pill>
              <SmallText>Next: {formatDate(item.next_due_date)}</SmallText>
            </View>
            <View style={styles.actions}>
              {item.is_active ? <View style={{ flex: 1 }}><Button title="Mark paid / received" onPress={() => recordItem(item)} /></View> : null}
              <View style={{ flex: 1 }}><Button title={item.is_active ? "Pause" : "Resume"} kind="secondary" onPress={() => void toggleItem(item)} /></View>
              <Pressable style={styles.deleteButton} onPress={() => deleteItem(item)} accessibilityRole="button" accessibilityLabel={"Delete " + item.name}>
                <Icon name="trash" size={18} color={colors.danger} />
              </Pressable>
            </View>
          </Card>
        )) : <EmptyState message="No recurring schedules yet. Add rent, subscriptions, bills or regular income." actionLabel="Add schedule" onAction={() => setFormOpen(true)} />}

        <SmallText>Schedules never create transactions automatically. Mark each occurrence as paid or received to add it to your ledger.</SmallText>
      </Screen>

      <Modal visible={formOpen} animationType="slide" onRequestClose={resetForm}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New recurring schedule</Text>
            <Pressable onPress={resetForm} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Input label="Name" value={name} onChangeText={setName} placeholder="Rent, Netflix, Salary" maxLength={100} />
            <Input label="Amount (₹)" value={amountValue} onChangeText={setAmountValue} placeholder="499" keyboardType="decimal-pad" />
            <SmallText>Transaction type</SmallText>
            <ChipRow values={["Expense", "Income"]} selected={kind} onSelect={setKind} />
            <Input label="Category" value={category} onChangeText={setCategory} placeholder="Subscriptions" maxLength={50} />
            <SmallText>Frequency</SmallText>
            <ChipRow values={["Weekly", "Monthly", "Yearly"]} selected={frequency} onSelect={setFrequency} />
            <Input label="Next due date (YYYY-MM-DD)" value={nextDueDate} onChangeText={setNextDueDate} placeholder="2026-11-15" autoCapitalize="none" />
            <Button title="Create schedule" onPress={() => void createItem()} loading={saving} disabled={saving} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  metricRow: { flexDirection: "row", gap: 10 },
  metricCard: { flex: 1, gap: 8, padding: 14 },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  itemCard: { gap: 13, padding: 15 },
  itemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  itemName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  itemAmount: { color: colors.text, fontSize: 14, fontWeight: "700" },
  dueRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  deleteButton: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  modalRoot: { flex: 1, backgroundColor: colors.background },
  modalHeader: { minHeight: 108, paddingTop: 48, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  modalContent: { padding: 16, gap: 16, paddingBottom: 40 },
});
