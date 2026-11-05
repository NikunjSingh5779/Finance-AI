import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppProvider } from "../src/AppContext";
import { Icon, type IconName } from "../src/icons";
import { colors, tokens } from "../src/theme";

const NAV_ITEMS: Array<{ path: string; label: string; icon: IconName }> = [
  { path: "/", label: "Overview", icon: "home" },
  { path: "/transactions", label: "Transactions", icon: "transactions" },
  { path: "/budgets", label: "Budgets", icon: "budgets" },
  { path: "/planning", label: "Planning", icon: "planning" },
  { path: "/insights", label: "Insights", icon: "insights" },
  { path: "/ai", label: "Assistant", icon: "assistant" },
];

function BottomNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.navBar, { paddingBottom: insets.bottom, minHeight: 60 + insets.bottom + 1 }]}>
      <View style={styles.navTabs}>
        {NAV_ITEMS.map((item) => {
          const active = item.path === "/" ? pathname === "/" || pathname === "" : pathname.startsWith(item.path);
          return (
            <Pressable
              key={item.path}
              onPress={() => router.push(item.path)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}
            >
              <Icon name={item.icon} size={22} color={active ? colors.primary : colors.muted} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        <View style={styles.content}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: "fade" }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="transactions" />
            <Stack.Screen name="budgets" />
            <Stack.Screen name="planning" />
            <Stack.Screen name="recurring" />
            <Stack.Screen name="insights" />
            <Stack.Screen name="ai" />
            <Stack.Screen name="settings" />
          </Stack>
        </View>
        <BottomNavigation />
      </View>
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, minHeight: 0 },
  navBar: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, minHeight: tokens.navigationCompactHeight, paddingTop: 4 },
  navTabs: { height: tokens.navigationTabHeight, flexDirection: "row", alignItems: "stretch" },
  navItem: { flex: 1, minWidth: 48, alignItems: "center", justifyContent: "center", gap: 3 },
  navPressed: { opacity: 0.72 },
  navLabel: { color: colors.muted, fontSize: 11, lineHeight: 14, fontWeight: "600" },
  navLabelActive: { color: colors.primary, fontWeight: "600" },
});
