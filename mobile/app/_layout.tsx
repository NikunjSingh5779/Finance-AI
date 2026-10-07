import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, Text, type ColorValue } from "react-native";
import { AppProvider } from "../src/AppContext";
import { colors } from "../src/theme";

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 17, fontWeight: "700" }}>{glyph}</Text>;
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" backgroundColor={colors.background} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.subtle,
          tabBarStyle: {
            display: Platform.OS === "web" ? "none" : "flex",
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 64,
            paddingTop: 6,
            paddingBottom: 7,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "600",
          },
          tabBarItemStyle: {
            borderRadius: 8,
            marginHorizontal: 2,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Overview", tabBarIcon: ({ color }) => <TabIcon glyph="⊞" color={color} /> }} />
        <Tabs.Screen name="transactions" options={{ title: "Transactions", tabBarIcon: ({ color }) => <TabIcon glyph="⇄" color={color} /> }} />
        <Tabs.Screen name="planning" options={{ title: "Planning", tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }} />
        <Tabs.Screen name="insights" options={{ title: "Insights", tabBarIcon: ({ color }) => <TabIcon glyph="◈" color={color} /> }} />
        <Tabs.Screen name="ai" options={{ title: "AI Assistant", tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} /> }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} /> }} />
      </Tabs>
    </AppProvider>
  );
}
