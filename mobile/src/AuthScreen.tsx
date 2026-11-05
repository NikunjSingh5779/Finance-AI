import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Input } from "./components";
import { colors } from "./theme";
import { Icon } from "./icons";

export interface AuthScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string, name: string) => Promise<boolean>;
}

export function AuthScreen({ onLogin, onSignup }: AuthScreenProps) {
  const [signupMode, setSignupMode] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password || (signupMode && name.trim().length < 2)) {
      setError(signupMode ? "Enter your name, email and password." : "Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (signupMode) {
        const requiresConfirmation = await onSignup(cleanEmail, password, name.trim());
        if (requiresConfirmation) {
          setMessage("Account created. Check your email to confirm the account, then sign in.");
          setSignupMode(false);
          setPassword("");
        }
      } else {
        await onLogin(cleanEmail, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.brandMark}><Text style={styles.brandEmoji}>💰</Text></View>
      <Text style={styles.title}>FinanceAI</Text>
      <Text style={styles.subtitle}>
        {signupMode ? "Create your private finance workspace." : "Sign in to your private finance workspace."}
      </Text>

      <View style={styles.card}>
        {signupMode ? (
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            autoCapitalize="words"
            autoCorrect={false}
          />
        ) : null}

        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
        />

        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={signupMode ? "new-password" : "current-password"}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Button
          title={busy ? (signupMode ? "Creating account…" : "Signing in…") : (signupMode ? "Create account" : "Sign in")}
          onPress={() => void submit()}
          disabled={busy}
        />

        {busy ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}

        <Pressable
          onPress={() => {
            setSignupMode((value) => !value);
            setError("");
            setMessage("");
          }}
          accessibilityRole="button"
          style={styles.switchButton}
        >
          <Text style={styles.switchText}>
            {signupMode ? "Already have an account? Sign in" : "New to FinanceAI? Create an account"}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.privacy}>
        Your financial data is isolated to your authenticated account.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginBottom: 14,
  },
  brandEmoji: { fontSize: 30 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 20, maxWidth: 340 },
  card: { width: "100%", maxWidth: 420, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 18, gap: 12 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  message: { color: colors.primary, fontSize: 13, lineHeight: 19 },
  spinner: { marginTop: 2 },
  switchButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  switchText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  privacy: { color: colors.subtle, fontSize: 11, textAlign: "center", marginTop: 18, maxWidth: 340 },
});
