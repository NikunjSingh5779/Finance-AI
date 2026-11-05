import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthScreen } from "./AuthScreen";
import { ApiError, FinanceApi, type AuthSession } from "./api";
import { colors } from "./theme";

const SESSION_KEY = "financeai.auth.session";

async function readStoredSession(): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(SESSION_KEY);
  try {
    const SecureStore = await import("expo-secure-store");
    const secureValue = await SecureStore.getItemAsync(SESSION_KEY);
    if (secureValue) return secureValue;

    // Migrate sessions stored by older builds.
    const legacy = await AsyncStorage.getItem(SESSION_KEY);
    if (legacy) {
      await SecureStore.setItemAsync(SESSION_KEY, legacy);
      await AsyncStorage.removeItem(SESSION_KEY);
    }
    return legacy;
  } catch {
    return AsyncStorage.getItem(SESSION_KEY);
  }
}

async function writeStoredSession(value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(SESSION_KEY, value);
    return;
  }
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(SESSION_KEY, value);
  } catch {
    await AsyncStorage.setItem(SESSION_KEY, value);
  }
}

async function removeStoredSession(): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(SESSION_KEY);
    return;
  }
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } finally {
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
  }
}

function firstValid(values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const normalized = value?.trim().replace(/\/+$/, "");
    if (normalized && /^https?:\/\//i.test(normalized)) return normalized;
  }
  return null;
}

function detectApiUrl(): string {
  const envValue =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_URL : undefined;
  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  const explicit = firstValid([envValue, configured]);
  if (explicit) return explicit;

  const webHost =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.hostname
      : undefined;

  if (webHost) {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    return `${protocol}://${webHost}:8000`;
  }

  const hostUri = Constants.expoConfig?.hostUri;
  const expoHost = hostUri?.split(":")[0];

  return expoHost && expoHost !== "localhost" && expoHost !== "127.0.0.1"
    ? `http://${expoHost}:8000`
    : Platform.OS === "android"
      ? "http://10.0.2.2:8000"
      : "http://127.0.0.1:8000";
}

interface AppContextValue {
  apiBaseUrl: string;
  api: FinanceApi;
  ready: boolean;
  authRequired: boolean;
  user: { id: string; email?: string; name?: string } | null;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl] = useState(detectApiUrl());
  const api = useMemo(() => new FinanceApi(apiBaseUrl), [apiBaseUrl]);

  const [checked, setChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState<AppContextValue["user"]>(null);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    let active = true;
    api.setSessionChangeHandler(async (next) => {
      if (next) {
        await writeStoredSession(JSON.stringify(next));
      } else {
        await removeStoredSession();
      }
      if (!active) return;
      setSession(next);
      setUser(next ? {
        id: next.user?.id || "",
        email: next.user?.email,
        name: next.user?.user_metadata?.name || next.user?.user_metadata?.full_name,
      } : null);
    });
    return () => {
      active = false;
      api.setSessionChangeHandler(null);
    };
  }, [api]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      let saved: AuthSession | null = null;
      try {
        const stored = await readStoredSession();
        if (stored) {
          saved = JSON.parse(stored) as AuthSession;
          api.setSession(saved);
        }

        const config = await api.authConfig();
        if (!mounted) return;
        setAuthRequired(config.required);
        if (!config.required) {
          setChecked(true);
          return;
        }
        if (!saved) {
          setChecked(true);
          return;
        }

        let me: { id: string };
        try {
          me = await api.me();
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) {
            // A connection issue must not erase a valid saved session.
            setSession(saved);
            setUser({
              id: saved.user?.id || "",
              email: saved.user?.email,
              name: saved.user?.user_metadata?.name || saved.user?.user_metadata?.full_name,
            });
            return;
          }
          const refreshed = await api.refreshSession();
          if (!refreshed) return;
          saved = refreshed;
          me = await api.me();
        }

        if (!mounted) return;
        setSession(saved);
        setUser({
          id: me.id,
          email: saved.user?.email,
          name: saved.user?.user_metadata?.name || saved.user?.user_metadata?.full_name,
        });
      } catch {
        if (mounted) {
          // Keep saved credentials for retry when auth/backend is temporarily offline.
          setAuthRequired(true);
          if (saved) {
            setSession(saved);
            setUser({
              id: saved.user?.id || "",
              email: saved.user?.email,
              name: saved.user?.user_metadata?.name || saved.user?.user_metadata?.full_name,
            });
          }
        }
      } finally {
        if (mounted) setChecked(true);
      }
    };

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [api]);

  const persistSession = async (next: AuthSession) => {
    api.setSession(next);
    await writeStoredSession(JSON.stringify(next));
    setSession(next);
    setUser({
      id: next.user?.id || "",
      email: next.user?.email,
      name: next.user?.user_metadata?.name,
    });
  };

  const handleLogin = async (email: string, password: string) => {
    const next = await api.login(email, password);
    if (!next.access_token || !next.refresh_token) {
      throw new Error("Login succeeded without an active session.");
    }
    await persistSession(next);
  };

  const handleSignup = async (
    email: string,
    password: string,
    name: string,
  ) => {
    const next = await api.signup(email, password, name);
    if (!next.access_token || !next.refresh_token) return true;
    await persistSession(next);
    return false;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Local logout must succeed even when the backend is unavailable.
    }
    api.clearSession();
    await removeStoredSession();
    setSession(null);
    setUser(null);
  };

  if (!checked) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Connecting to FinanceAI…</Text>
      </View>
    );
  }

  if (authRequired && !session) {
    return (
      <AppContext.Provider
        value={{
          apiBaseUrl,
          api,
          ready: false,
          authRequired,
          user: null,
          logout,
        }}
      >
        <AuthScreen onLogin={handleLogin} onSignup={handleSignup} />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider
      value={{
        apiBaseUrl,
        api,
        ready: true,
        authRequired,
        user,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useFinance() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useFinance must be used inside AppProvider");
  return context;
}

export function formatDate(value: string): string {
  const date = new Date(value.includes("T") ? value : value + "T00:00:00");
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function currentMonth(): string {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
  },
});
