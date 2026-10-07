import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button, Card, ChipRow, EmptyState, ErrorBanner, Header, Input, LoadingState, Money, Pill, Screen, SectionTitle, SmallText } from "../src/components";
import { useFinance } from "../src/AppContext";
import type { Account, AccountType } from "../src/types";
import { colors } from "../src/theme";

const accountTypes: AccountType[] = ["checking", "savings", "cash", "credit", "investment"];

function accountGlyph(type: AccountType) {
  if (type === "investment") return "↗";
  if (type === "credit") return "▣";
  if (type === "cash") return "₹";
  if (type === "savings") return "◉";
  return "▤";
}

export default function SettingsScreen() {
  const { api, apiBaseUrl } = useFinance();
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("0");
  const [type, setType] = useState<AccountType>("checking");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAccounts(await api.accounts()); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Could not load accounts."); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const openForm = (account?: Account) => {
    if (account) {
      setEditingId(account.id);
      setName(account.name);
      setBalance(String(account.balance));
      setType(account.type);
    } else {
      setEditingId(null); setName(""); setBalance("0"); setType("checking");
    }
    setMessage(""); setFormOpen(true);
  };

  const saveAccount = async () => {
    const numeric = Number(balance);
    if (!name.trim() || !Number.isFinite(numeric)) { setMessage("Enter an account name and a valid balance."); return; }
    setSaving(true); setMessage("");
    try {
      const payload = { name: name.trim(), balance: numeric, type };
      const saved = editingId ? await api.updateAccount(editingId, payload) : await api.createAccount(payload);
      setAccounts((items) => editingId ? items.map((item) => item.id === editingId ? saved : item) : items.concat(saved));
      setFormOpen(false); setEditingId(null); setName(""); setBalance("0"); setType("checking");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not save account."); }
    finally { setSaving(false); }
  };

  const deleteAccount = (account: Account) => {
    Alert.alert("Delete account", "Delete “" + account.name + "”? ", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.deleteAccount(account.id); setAccounts((items) => items.filter((item) => item.id !== account.id)); }
        catch (err) { setMessage(err instanceof Error ? err.message : "Could not delete account."); }
      }},
    ]);
  };

  const openDocs = async () => {
    const { Linking } = await import("react-native");
    await Linking.openURL(apiBaseUrl.replace(/\/+$/, "") + "/docs");
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
      <Header title="Settings" action="none" />
      {message ? <ErrorBanner message={message} /> : null}

      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          <View style={styles.profileIcon}><Text style={styles.profileIconText}>⚙</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileTitle}>FinanceAI</Text>
            <SmallText>Connection, accounts and developer settings.</SmallText>
          </View>
          <Pill tone="success">Local</Pill>
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <View><SectionTitle>Accounts</SectionTitle><SmallText>{accounts.length} configured</SmallText></View>
        <Pressable onPress={() => formOpen ? setFormOpen(false) : openForm()} style={styles.circleButton}><Text style={styles.circleText}>{formOpen ? "×" : "+"}</Text></Pressable>
      </View>

      {formOpen ? (
        <Card>
          <SectionTitle>{editingId ? "Edit account" : "New account"}</SectionTitle>
          <Input label="Account name" value={name} onChangeText={setName} placeholder="Main Wallet" />
          <Input label="Opening balance (₹)" value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="50000" />
          <SmallText>Account type</SmallText>
          <ChipRow values={accountTypes} selected={type} onSelect={(value) => setType(value as AccountType)} />
          <Button title={editingId ? "Save changes" : "Create account"} onPress={() => void saveAccount()} loading={saving} />
        </Card>
      ) : null}

      {loading ? <Card><LoadingState /></Card> : accounts.length === 0 ? (
        <Card><EmptyState message="No accounts configured yet." /></Card>
      ) : (
        accounts.map((account, index) => (
          <Card key={account.id} style={styles.accountCard}>
            <View style={styles.accountTop}>
              <View style={[styles.accountIcon, { backgroundColor: [colors.primarySoft, colors.infoSoft, colors.warningSoft, colors.dangerSoft][index % 4] }]}><Text style={{ color: [colors.primary, colors.info, colors.warning, colors.danger][index % 4], fontSize: 15 }}>{accountGlyph(account.type)}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.accountName}>{account.name}</Text><SmallText>{account.type}</SmallText></View>
              <Money value={account.current_balance ?? account.balance} size={17} />
            </View>
            <View style={styles.accountBottom}>
              <SmallText>Current balance</SmallText>
              <View style={styles.inlineActions}>
                <Pressable style={styles.editButton} onPress={() => openForm(account)}><Text style={styles.editText}>Edit</Text></Pressable>
                <Pressable style={styles.deleteButton} onPress={() => deleteAccount(account)}><Text style={styles.deleteText}>Delete</Text></Pressable>
              </View>
            </View>
          </Card>
        ))
      )}

      <SectionTitle>Developer & API</SectionTitle>
      <Card style={styles.devCard}>
        <View style={styles.sectionRow}><View><Text style={styles.devTitle}>API documentation</Text><SmallText>Inspect the FastAPI routes and backend health.</SmallText></View><Pill tone="info">Swagger</Pill></View>
        <Button title="Open /docs" onPress={() => void openDocs()} kind="secondary" />
      </Card>

      <Card>
        <Text style={styles.devTitle}>Public release requirement</Text>
        <SmallText>Before exposing this personal backend publicly, add authentication, authorization, per-user data isolation, HTTPS, secure secret handling, account deletion and production monitoring.</SmallText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileCard: { paddingVertical: 15 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  profileIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  profileIconText: { color: colors.primary, fontSize: 16 },
  profileTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  circleButton: { width: 34, height: 34, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  circleText: { color: colors.muted, fontSize: 23, lineHeight: 26 },
  accountCard: { gap: 9 },
  accountTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  accountIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  accountName: { color: colors.text, fontSize: 13, fontWeight: "800" },
  accountBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inlineActions: { flexDirection: "row", gap: 7 },
  editButton: { paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.surfaceRaised, borderRadius: 7, borderWidth: 1, borderColor: colors.border },
  editText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  deleteButton: { paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.dangerSoft, borderRadius: 7, borderWidth: 1, borderColor: "rgba(239,68,68,.25)" },
  deleteText: { color: colors.danger, fontSize: 10, fontWeight: "800" },
  devCard: { gap: 12 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  devTitle: { color: colors.text, fontSize: 13, fontWeight: "800", marginBottom: 3 },
}