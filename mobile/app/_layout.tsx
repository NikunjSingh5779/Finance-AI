import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, type ColorValue } from "react-native";
import { AppProvider } from "../src/AppContext";
import { colors } from "../src/theme";

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 16, fontWeight: "700" }}>{glyph}</Text>;
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" backgroundColor={colors.background} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.subtle,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 64,
            paddingTop: 7,
            paddingBottom: 7,
          },
          tabBarLabelStyle: {
            fontSize: 9,
            fontWeight: "600",
            marginTop: 1,
          },
          tabBarItemStyle: {
            borderRadius: 8,
            marginHorizontal: 1,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Overview", tabBarActiveTintColor: colors.primary, tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} /> }} />
        <Tabs.Screen name="transactions" options={{ title: "Transactions", tabBarIcon: ({ color }) => <TabIcon glyph="☷" color={color} /> }} />
        <Tabs.Screen name="budgets" options={{ title: "Budgets", tabBarIcon: ({ color }) => <TabIcon glyph="▣" color={color} /> }} />
        <Tabs.Screen name="planning" options={{ title: "Planning", tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} /> }} />
        <Tabs.Screen name="insights" options={{ title: "Insights", tabBarActiveTintColor: colors.primary, tabBarIcon: ({ color }) => <TabIcon glyph="◌" color={color} /> }} />
        <Tabs.Screen name="ai" options={{ title: "Assistant", tabBarActiveTintColor: colors.primary, tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} /> }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
    </AppProvider>
  );
}
