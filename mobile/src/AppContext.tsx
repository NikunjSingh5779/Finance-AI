import Constants from "expo-constants";
import { Platform } from "react-native";
import { createContext, useContext, useMemo, useState } from "react";
import { FinanceApi } from "./api";

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

  const webHost =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.hostname
      : undefined;

  if (webHost) {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    return `${protocol}://${webHost}:8000`;
  }

  // Expo development exposes the host machine through hostUri.
  // Reuse that host and switch only the backend port from 8081 to 8000.
  const hostUri = Constants.expoConfig?.hostUri;
  const expoHost = hostUri?.split(":")[0];

  return (
    firstValid([envValue, configured]) ||
    (expoHost && expoHost !== "localhost" && expoHost !== "127.0.0.1"
      ? `http://${expoHost}:8000`
      : Platform.OS === "android"
        ? "http://10.0.2.2:8000"
        : "http://127.0.0.1:8000")
  );
}

interface AppContextValue {
  apiBaseUrl: string;
  api: FinanceApi;
  ready: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl] = useState(detectApiUrl());
  const api = useMemo(() => new FinanceApi(apiBaseUrl), [apiBaseUrl]);

  return (
    <AppContext.Provider value={{ apiBaseUrl, api, ready: true }}>
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
