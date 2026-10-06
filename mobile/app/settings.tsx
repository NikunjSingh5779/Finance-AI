import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  ErrorBanner,
  Header,
  Input,
  Pill,
  Screen,
  SectionTitle,
  SmallText,
} from "../src/components";
import { FinanceApi } from "../src/api";
import { useFinance } from "../src/AppContext";
import { colors } from "../src/theme";

export default function SettingsScreen() {
  const { apiBaseUrl, setApiBaseUrl } = useFinance();
  const [draft, setDraft] = useState(apiBaseUrl);
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

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

  const openDocs = async () => {
    await Linking.openURL(apiBaseUrl.replace(/\/+$/, "") + "/docs");
  };

  return (
    <Screen>
      <Header title="Settings" subtitle="Connect the mobile app to your FinanceAI backend." />

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
        {status === "error" ? <ErrorBanner message={message} /> : null}
        {status === "ok" ? <SmallText>{message}</SmallText> : null}
      </Card>

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
        <Text style={styles.body}>Open the FastAPI interactive documentation to verify routes and test requests.</Text>
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
});
