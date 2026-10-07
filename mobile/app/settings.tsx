import { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, StyleSheet, Text, View } from "react-native";
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
  Pill,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { FinanceApi } from "../src/api";
import { useFinance } from "../src/AppContext";
import type { Account, AccountType } from "../src/types";
import { colors } from "../src/theme";

const accountTypes: AccountType[] = [
  "checking",
  "savings",
  "cash",
  "credit",
  "investment",
];

export default function SettingsScreen() {
  const { api, apiBaseUrl, setApiBaseUrl } = useFinance();
  const [draft, setDraft] = useState(apiBaseUrl);
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountForm, setAccountForm] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountBalance, setAccountBalance] = useState("0");
  const [accountType, setAccountType] = useState<AccountType>("checking");
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      setAccounts(await api.accounts());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load accounts.");
    } finally {
      setLoadingAccounts(false);
    }
  }, [api]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const saveAndCheck = async () => {
    const normalized = draft.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalized)) {
      setStatus("error");
      setMessage("API URL must start with http:// or https://");
      return;
    }

    setStatus("checking");
    setMessage("");

    try {
      const nextApi = new FinanceApi(normalized);
      const response = await nextApi.health();
      await setApiBaseUrl(normalized);
      setStatus("ok");
      setMessage((response.service || "FinanceAI") + " backend is reachable.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Connection failed.");
    }
  };

  const createAccount = async () => {
    const balance = Number(accountBalance);
    if (!accountName.trim() || !Number.isFinite(balance)) {
      setMessage("Enter an account name and a finite opening balance.");
      return;
    }

    setSavingAccount(true);
    try {
      const account = await api.createAccount({
        name: accountName.trim(),
        balance,
        type: accountType,
      });
      setAccounts((items) => items.concat(account));
      setAccountName("");
      setAccountBalance("0");
      setAccountType("checking");
      setAccountForm(false);
      setMessage("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setSavingAccount(false);
    }
  };

  const deleteAccount = async (account: Account) => {
    try {
      await api.deleteAccount(account.id);
      setAccounts((items) => items.filter((item) => item.id !== account.id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete account.");
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadAccounts();
    setRefreshing(false);
  };

  const openDocs = async () => {
    const { Linking } = await import("react-native");
    await Linking.openURL(apiBaseUrl.replace(/\/+$/, "") + "/docs");
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <Header title="Settings" subtitle="Backend connection, accounts and release configuration." />

      {message && status !== "ok" ? <ErrorBanner message={message} /> : null}

      <Card>
        <SectionTitle>Backend connection</SectionTitle>
        <Input
          label="FinanceAI API URL"
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.10:8000"
        />
        <Button title="Save & test connection" onPress={() => void saveAndCheck()} loading={status === "checking"} />
        {status === "ok" ? <Pill tone="success">Connected</Pill> : null}
        {status === "ok" ? <SmallText>{message}</SmallText> : null}
      </Card>

      <View style={styles.rowBetween}>
        <SectionTitle>Accounts</SectionTitle>
        <Button title={accountForm ? "Close" : "+ Account"} onPress={() => setAccountForm((v) => !v)} kind={accountForm ? "secondary" : "primary"} />
      </View>

      {accountForm ? (
        <Card>
          <Input label="Account name" value={accountName} onChangeText={setAccountName} placeholder="Main bank" />
          <Input label="Opening balance (₹)" value={accountBalance} onChangeText={setAccountBalance} keyboardType="decimal-pad" placeholder="25000" />
          <SmallText>Type</SmallText>
          <ChipRow
            values={accountTypes}
            selected={accountType}
            onSelect={(value) => setAccountType(value as AccountType)}
          />
          <Button title="Create account" onPress={() => void createAccount()} loading={savingAccount} />
        </Card>
      ) : null}

      {loadingAccounts ? (
        <Card><LoadingState /></Card>
      ) : accounts.length === 0 ? (
        <Card><EmptyState message="No accounts configured yet." /></Card>
      ) : (
        accounts.map((account) => (
          <Card key={account.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{account.name}</Text>
                <SmallText>{account.type}</SmallText>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Money value={account.current_balance ?? account.balance} size={18} />
                <SmallText>current balance</SmallText>
              </View>
            </View>
            <Button title="Delete account" onPress={() => deleteAccount(account)} kind="danger" />
          </Card>
        ))
      )}

      <Card>
        <SectionTitle>Local development</SectionTitle>
        <Text style={styles.body}>
          Android emulator: http://10.0.2.2:8000. Physical phone: use your PC LAN IP such as http://192.168.x.x:8000.
          iOS Simulator: http://127.0.0.1:8000. The backend must listen on a reachable interface.
        </Text>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <SectionTitle>API documentation</SectionTitle>
          <Pill tone="info">Swagger</Pill>
        </View>
        <Text style={styles.body}>Use FastAPI Swagger to inspect and test the backend routes.</Text>
        <Button title="Open /docs" onPress={() => void openDocs()} kind="secondary" />
      </Card>

      <Card>
        <SectionTitle>Public release requirement</SectionTitle>
        <Text style={styles.body}>
          The current backend is a personal single-database service. Before exposing it to multiple public users,
          add authentication and authorization, per-user data isolation, HTTPS, a hosted persistent database,
          secure secret handling, privacy/account deletion flows and production monitoring.
        </Text>
      </Card>

      <Card>
        <SectionTitle>App scope</SectionTitle>
        <SmallText>
          Dashboard, transactions, accounts, budgets, goals, net worth, reports, insights and AI are wired to the existing API.
        </SmallText>
        <SmallText>The mobile client never accesses SQLite directly.</SmallText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.muted,
    lineHeight: 20,
    fontSize: 13,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
});
