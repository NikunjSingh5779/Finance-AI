import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text } from "react-native";
import { AppProvider } from "../src/AppContext";
import { colors } from "../src/theme";

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: "800" }}>{glyph}</Text>;
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 66,
            paddingTop: 7,
            paddingBottom: 8,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "700",
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} /> }} />
        <Tabs.Screen name="transactions" options={{ title: "Transactions", tabBarIcon: ({ color }) => <TabIcon glyph="⇄" color={color} /> }} />
        <Tabs.Screen name="planning" options={{ title: "Planning", tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }} />
        <Tabs.Screen name="insights" options={{ title: "Insights", tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} /> }} />
        <Tabs.Screen name="ai" options={{ title: "AI", tabBarIcon: ({ color }) => <TabIcon glyph="◇" color={color} /> }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} /> }} />
      </Tabs>
    </AppProvider>
  );
}
