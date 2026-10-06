import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { FinanceApi } from "./api";

const STORAGE_KEY = "financeai.apiUrl";

function defaultApiUrl(): string {
  const envValue =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_API_URL : undefined;
  return (
    envValue ||
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    "http://127.0.0.1:8000"
  );
}

interface AppContextValue {
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => Promise<void>;
  api: FinanceApi;
  ready: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl, setApiBaseUrlState] = useState(defaultApiUrl());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored?.trim()) setApiBaseUrlState(stored.trim());
      })
      .finally(() => setReady(true));
  }, []);

  const setApiBaseUrl = async (url: string) => {
    const normalized = url.trim().replace(/\/+$/, "");
    setApiBaseUrlState(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, normalized);
  };

  const api = useMemo(() => new FinanceApi(apiBaseUrl), [apiBaseUrl]);

  return (
    <AppContext.Provider value={{ apiBaseUrl, setApiBaseUrl, api, ready }}>
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
