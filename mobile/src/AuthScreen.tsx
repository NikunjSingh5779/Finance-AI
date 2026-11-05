import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Input } from "./components";
import { colors } from "./theme";
import { Icon } from "./icons";

export interface AuthScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string, name: string) => Promise<boolean>;
  onGoogleSignIn?: () => Promise<void>;
  onForgotPassword?: (email: string) => Promise<void>;
  onResetPassword?: (password: string) => Promise<void>;
  passwordResetMode?: boolean;
}

export function AuthScreen({
  onLogin,
  onSignup,
  onGoogleSignIn,
  onForgotPassword,
  onResetPassword,
  passwordResetMode = false,
}: AuthScreenProps) {
  const [signupMode, setSignupMode] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const passwordMode = signupMode || passwordResetMode;

  const submit = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (forgotMode) {
      if (!cleanEmail) {
        setError("Enter your email address first.");
        return;
      }
      if (!onForgotPassword) {
        setError("Password recovery is not available right now.");
        return;
      }
    } else if (passwordResetMode) {
      if (!password) {
        setError("Enter your new password.");
        return;
      }
    } else if (!cleanEmail || !password || (signupMode && name.trim().length < 2)) {
      setError(signupMode ? "Enter your name, email and password." : "Enter your email and password.");
      return;
    }

    if (passwordMode) {
      if (
        password.length < 8
        || !/\d/.test(password)
        || !/[^A-Za-z0-9\s]/.test(password)
      ) {
        setError("Use at least 8 characters, including one number and one special character.");
        return;
      }
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (forgotMode) {
        await onForgotPassword!(cleanEmail);
        setMessage("If that email is registered, a password reset link has been sent.");
        setForgotMode(false);
        setPassword("");
      } else if (passwordResetMode) {
        if (!onResetPassword) throw new Error("Password reset is not available right now.");
        await onResetPassword(password);
      } else if (signupMode) {
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
        {passwordResetMode
          ? "Choose a new password for your FinanceAI account."
          : forgotMode
            ? "We'll send a secure password reset link to your email."
            : signupMode
              ? "Create your private finance workspace."
              : "Sign in to your private finance workspace."}
      </Text>

      <View style={styles.card}>
        {signupMode && !passwordResetMode ? (
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            autoCapitalize="words"
            autoCorrect={false}
          />
        ) : null}

        {!passwordResetMode ? <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
        /> : null}

        {!forgotMode ? <View style={styles.passwordField}>
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={passwordMode ? "8+ characters, number and symbol" : "Your password"}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={passwordMode ? "new-password" : "current-password"}
            style={styles.passwordInput}
          />
          <Pressable
            style={styles.passwordToggle}
            onPress={() => setShowPassword((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Icon name="eye" size={19} color={colors.muted} />
          </Pressable>
        </View> : null}

        {(signupMode || passwordResetMode) ? (
          <View style={styles.passwordRules}>
            <Text style={[styles.passwordRule, password.length >= 8 && styles.passwordRuleMet]}>
              {password.length >= 8 ? "✓" : "○"} At least 8 characters
            </Text>
            <Text style={[styles.passwordRule, /\d/.test(password) && styles.passwordRuleMet]}>
              {/\d/.test(password) ? "✓" : "○"} At least one number
            </Text>
            <Text style={[styles.passwordRule, /[^A-Za-z0-9\s]/.test(password) && styles.passwordRuleMet]}>
              {/[^A-Za-z0-9\s]/.test(password) ? "✓" : "○"} At least one special character
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Button
          title={
            busy
              ? (forgotMode ? "Sending reset link…" : passwordResetMode ? "Updating password…" : signupMode ? "Creating account…" : "Signing in…")
              : (forgotMode ? "Send reset link" : passwordResetMode ? "Update password" : signupMode ? "Create account" : "Sign in")
          }
          onPress={() => void submit()}
          disabled={busy}
        />

        {busy ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
        {!signupMode && !forgotMode && !passwordResetMode && onForgotPassword ? (
          <Pressable
            onPress={() => {
              setForgotMode(true);
              setError("");
              setMessage("");
              setPassword("");
            }}
            style={styles.forgotButton}
            accessibilityRole="button"
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        ) : null}

        {onGoogleSignIn && Platform.OS !== "web" && !signupMode && !forgotMode && !passwordResetMode ? (
          <Pressable
            onPress={() => {
              setBusy(true);
              setError("");
              void onGoogleSignIn().catch((err) => {
                setError(err instanceof Error ? err.message : "Google sign-in failed.");
              }).finally(() => setBusy(false));
            }}
            disabled={busy}
            accessibilityRole="button"
            style={styles.googleButton}
          >
            <Text style={styles.googleSymbol}>G</Text>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </Pressable>
        ) : null}

        {forgotMode ? (
          <Pressable
            onPress={() => { setForgotMode(false); setError(""); setMessage(""); }}
            accessibilityRole="button"
            style={styles.switchButton}
          >
            <Text style={styles.switchText}>Back to sign in</Text>
          </Pressable>
        ) : !passwordResetMode ? (
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
        ) : null}
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
  passwordField: { position: "relative" },
  passwordInput: { paddingRight: 48 },
  passwordToggle: { position: "absolute", right: 12, top: 28, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  passwordRules: { gap: 4, marginTop: -4 },
  passwordRule: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  passwordRuleMet: { color: colors.primary },
  googleButton: { minHeight: 48, borderRadius: 12, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  googleSymbol: { color: "#4285F4", fontSize: 22, fontWeight: "800" },
  googleButtonText: { color: "#202124", fontSize: 14, fontWeight: "700" },
  forgotButton: { alignSelf: "flex-end", paddingVertical: 3, paddingHorizontal: 2 },
  forgotText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  switchButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  switchText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  privacy: { color: colors.subtle, fontSize: 11, textAlign: "center", marginTop: 18, maxWidth: 340 },
});
