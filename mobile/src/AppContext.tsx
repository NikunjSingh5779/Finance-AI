import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AuthScreen } from "./AuthScreen";
import { FinanceApi, type AuthSession } from "./api";
import { colors } from "./theme";

const SESSION_KEY = "financeai.auth.session";

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
    let mounted = true;

    const bootstrap = async () => {
      try {
        const config = await api.authConfig();
        if (!mounted) return;
        setAuthRequired(config.required);

        if (!config.required) {
          setChecked(true);
          return;
        }

        const stored = await AsyncStorage.getItem(SESSION_KEY);
        if (!stored) {
          setChecked(true);
          return;
        }

        const saved = JSON.parse(stored) as AuthSession;
        api.setSession(saved);

        try {
          const me = await api.me();
          if (!mounted) return;
          setSession(saved);
          setUser({
            id: me.id,
            email: saved.user?.email,
            name: saved.user?.user_metadata?.name,
          });
        } catch {
          const refreshed = await api.refreshSession();
          if (!refreshed) {
            api.clearSession();
            await AsyncStorage.removeItem(SESSION_KEY);
            setChecked(true);
            return;
          }

          await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(refreshed));
          const me = await api.me();
          if (mounted) {
            setSession(refreshed);
            setUser({
              id: me.id,
              email: refreshed.user?.email,
              name: refreshed.user?.user_metadata?.name,
            });
          }
      } catch {
        if (mounted) setAuthRequired(false);
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
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
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
      // Local logout must succeed even if the backend is unavailable.
    }
    api.clearSession();
    await AsyncStorage.removeItem(SESSION_KEY);
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
