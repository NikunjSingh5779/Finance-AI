import { Slot, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppProvider } from "../src/AppContext";
import { colors } from "../src/theme";

const NAV_ITEMS = [
  { path: "/", label: "Overview", glyph: "⌂" },
  { path: "/transactions", label: "Transactions", glyph: "☷" },
  { path: "/budgets", label: "Budgets", glyph: "▣" },
  { path: "/planning", label: "Planning", glyph: "◉" },
  { path: "/insights", label: "Insights", glyph: "◌" },
  { path: "/ai", label: "Assistant", glyph: "✦" },
];

function BottomNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View style={styles.navBar}>
      {NAV_ITEMS.map((item) => {
        const active =
          item.path === "/"
            ? pathname === "/" || pathname === ""
            : pathname.startsWith(item.path);

        return (
          <Pressable
            key={item.path}
            onPress={() => router.push(item.path as never)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}
          >
            <Text style={[styles.navIcon, active && styles.navIconActive]}>{item.glyph}</Text>
            <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" backgroundColor={colors.background} />
      <View style={styles.root}>
        <View style={styles.content}>
          <Slot />
        </View>
        <BottomNavigation />
      </View>
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  navBar: {
    minHeight: 66,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-around",
    paddingHorizontal: 4,
    paddingTop: 5,
    paddingBottom: 5,
  },
  navItem: {
    flex: 1,
    maxWidth: 110,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    gap: 2,
  },
  navPressed: {
    opacity: 0.75,
  },
  navIcon: {
    color: colors.subtle,
    fontSize: 16,
    fontWeight: "700",
  },
  navIconActive: {
    color: colors.primary,
  },
  navLabel: {
    color: colors.subtle,
    fontSize: 8,
    fontWeight: "600",
  },
  navLabelActive: {
    color: colors.primary,
    fontWeight: "800",
  },
});
