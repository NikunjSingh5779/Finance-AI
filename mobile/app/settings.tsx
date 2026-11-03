import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, ChipRow, EmptyState, ErrorBanner, Header, Input, LoadingState, Money, Pill, Screen, SectionTitle, SmallText } from "../src/components";
import { useFinance } from "../src/AppContext";
import type { Account, AccountType } from "../src/types";
import { colors } from "../src/theme";
import { Icon } from "../src/icons";

const accountTypes: AccountType[] = ["checking", "savings", "cash", "credit", "investment"];

function accountIcon(type: AccountType) {
  if (type === "investment") return "insights" as const;
  if (type === "credit") return "credit-card" as const;
  if (type === "cash") return "wallet" as const;
  if (type === "savings") return "savings" as const;
  return "wallet" as const;
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
  const [backendStatus, setBackendStatus] = useState<"unknown" | "ok" | "offline">("unknown");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([api.accounts(), api.health()]);
      const accountsResult = results[0];
      const healthResult = results[1];
      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value);
      else throw accountsResult.reason;
      setBackendStatus(healthResult.status === "fulfilled" && healthResult.value.status === "ok" ? "ok" : "offline");
      if (healthResult.status === "rejected") setBackendStatus("offline");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const openForm = (account?: Account) => {
    if (account) {
      setEditingId(account.id);
      setName(account.name);
      setBalance(String(account.balance));
      setType(account.type);
    } else {
      setEditingId(null);
      setName("");
      setBalance("0");
      setType("checking");
    }
    setMessage("");
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
  };

  const saveAccount = async () => {
    const numeric = Number(balance);
    if (!name.trim() || !Number.isFinite(numeric)) {
      setMessage("Enter an account name and a valid balance.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const payload = { name: name.trim(), balance: numeric, type };
      const saved = editingId ? await api.updateAccount(editingId, payload) : await api.createAccount(payload);
      setAccounts((items) => editingId ? items.map((item) => item.id === editingId ? saved : item) : items.concat(saved));
      closeForm();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save account.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = (account: Account) => {
    Alert.alert("Delete account", "Delete “" + account.name + "”? ", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteAccount(account.id);
            setAccounts((items) => items.filter((item) => item.id !== account.id));
          } catch (err) {
            setMessage(err instanceof Error ? err.message : "Could not delete account.");
          }
        },
      },
    ]);
  };

  const openDocs = async () => {
    const { Linking } = await import("react-native");
    await Linking.openURL(apiBaseUrl.replace(/\/+$/, "") + "/docs");
  };

  return (
    <>
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
        <Header title="Settings" action="back" />
        {message ? <ErrorBanner message={message} /> : null}

        <Card style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.profileIcon}>
              <Icon name="settings" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileTitle}>FinanceAI</Text>
              <SmallText>Connection, accounts and developer settings.</SmallText>
            </View>
            <Pill tone="success">Local</Pill>
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <View>
            <SmallText>ACCOUNTS</SmallText>
            <SectionTitle>{accounts.length} linked account{accounts.length === 1 ? "" : "s"}</SectionTitle>
          </View>
          <Pressable style={styles.iconButton} onPress={() => openForm()} accessibilityRole="button" accessibilityLabel="Add account">
            <Icon name="plus" size={18} color={colors.text} />
          </Pressable>
        </View>

        {loading ? <Card><LoadingState /></Card> : accounts.length === 0 ? (
          <Card><EmptyState message="No accounts configured yet." actionLabel="Add account" onAction={() => openForm()} /></Card>
        ) : (
          <View style={styles.accountList}>
            {accounts.map((account, index) => (
              <Card key={account.id} style={styles.accountCard}>
                <View style={styles.accountTop}>
                  <View style={[styles.accountIcon, { backgroundColor: [colors.primarySoft, colors.infoSoft, colors.warningSoft, colors.dangerSoft][index % 4] }]}>
                    <Icon name={accountIcon(account.type)} size={19} color={[colors.primary, colors.info, colors.warning, colors.danger][index % 4]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountName}>{account.name}</Text>
                    <SmallText>{account.type}</SmallText>
                  </View>
                  <View style={styles.accountRight}>
                    <Money value={account.current_balance ?? account.balance} size={15} />
                    <Pressable onPress={() => openForm(account)} accessibilityLabel={"Edit " + account.name}>
                      <Icon name="edit" size={16} color={colors.muted} />
                    </Pressable>
                    <Pressable onPress={() => deleteAccount(account)} accessibilityLabel={"Delete " + account.name}>
                      <Icon name="trash" size={16} color={colors.danger} />
                    </Pressable>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        <View style={styles.sectionBlock}>
          <SmallText>DEVELOPER & API</SmallText>
          <SectionTitle>Developer API</SectionTitle>
          <Card style={styles.apiCard}>
            <View style={styles.sectionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.devTitle}>API documentation</Text>
                <SmallText>Inspect FastAPI routes and backend health.</SmallText>
              </View>
              <Pill tone="info">Swagger</Pill>
            </View>
            <Button title="Open /docs" onPress={() => void openDocs()} kind="secondary" />
          </Card>

          <Card style={styles.backendCard}>
            <View style={styles.backendIcon}><Icon name="settings" size={18} color={colors.muted} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.devTitle}>Backend status</Text>
              <SmallText>{backendStatus === "ok" ? "Backend is reachable and healthy." : backendStatus === "offline" ? "Backend is unavailable right now." : "Not checked — open /docs to verify connectivity."}</SmallText>
            </View>
            <Pill tone={backendStatus === "ok" ? "success" : backendStatus === "offline" ? "danger" : "neutral"}>
              {backendStatus === "ok" ? "Healthy" : backendStatus === "offline" ? "Offline" : "Unknown"}
            </Pill>
          </Card>

          <Card style={styles.securityCard}>
            <Icon name="warning" size={18} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.securityTitle}>Security warning</Text>
              <SmallText>Before public release, add authentication, authorization, per-user data isolation, HTTPS, secure secret handling and production monitoring.</SmallText>
            </View>
          </Card>
        </View>

        <View style={styles.sectionBlock}>
          <SmallText>APPEARANCE</SmallText>
          <Card style={styles.appearanceCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.devTitle}>Theme</Text>
              <SmallText>Dark mode</SmallText>
            </View>
            <Pill tone="success">Active</Pill>
          </Card>
        </View>

        <View style={styles.sectionBlock}>
          <SmallText>PROFILE</SmallText>
          <Card style={styles.profileSmallCard}>
            <View style={styles.profileSmallAvatar}><Text style={styles.profileSmallText}>AC</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.devTitle}>Alex Carter</Text>
              <SmallText>Personal FinanceAI workspace</SmallText>
            </View>
          </Card>
        </View>
      </Screen>

      <Modal visible={formOpen} animationType="slide" transparent={false} onRequestClose={closeForm}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalHeader}>
            <Pressable onPress={closeForm} disabled={saving} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>{editingId ? "Edit Account" : "Create Account"}</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {message ? <ErrorBanner message={message} /> : null}
            <Input label="Account name" value={name} onChangeText={setName} placeholder="Main Wallet" />
            <Input label={editingId ? "Current balance (₹)" : "Opening balance (₹)"} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="50000" />
            <SmallText>Account type</SmallText>
            <ChipRow values={accountTypes} selected={type} onSelect={(value) => setType(value as AccountType)} />
            <Button title={editingId ? "Save changes" : "Create account"} onPress={() => void saveAccount()} loading={saving} />
            {editingId ? <Button title="Delete account" onPress={() => {
              const account = accounts.find((item) => item.id === editingId);
              if (account) deleteAccount(account);
            }} kind="danger" /> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  profileCard: { padding: 16 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfacePositive, alignItems: "center", justifyContent: "center" },
  profileTitle: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  accountList: { gap: 10 },
  accountCard: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14 },
  accountTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  accountIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  accountName: { color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: 2 },
  accountRight: { alignItems: "flex-end", gap: 8 },
  sectionBlock: { gap: 12 },
  apiCard: { gap: 12 },
  backendCard: { minHeight: 97, flexDirection: "row", alignItems: "center", gap: 12 },
  backendIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  devTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  securityCard: { minHeight: 100, flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.surfaceWarning, borderColor: "rgba(245,168,0,.25)" },
  securityTitle: { color: colors.warning, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  appearanceCard: { minHeight: 96, flexDirection: "row", alignItems: "center" },
  profileSmallCard: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 12 },
  profileSmallAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  profileSmallText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  modalRoot: { flex: 1, backgroundColor: colors.background },
  modalHeader: { minHeight: 108, paddingTop: 48, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  modalContent: { padding: 16, gap: 16, paddingBottom: 40 },
});
