import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../src/theme";

export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.title}>Completing sign in…</Text>
      <Text style={styles.subtitle}>Your FinanceAI account is being verified.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background, gap: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 13, textAlign: "center" },
});
