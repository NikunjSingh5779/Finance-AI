import { Children, isValidElement } from "react";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type DimensionValue, type RefreshControlProps, type TextInputProps, type ViewStyle,
} from "react-native";
import { colors, radii } from "./theme";
import { Icon } from "./icons";

export function Screen({ children, refreshControl }: { children: React.ReactNode; refreshControl?: React.ReactElement<RefreshControlProps> }) {
  const items = Children.toArray(children);
  const first = items[0];
  const hasHeader = isValidElement(first) && first.type === Header;
  const header = hasHeader ? first : null;
  const body = hasHeader ? items.slice(1) : items;
  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    </View>
  );
}

export function Header({ title, subtitle, action = "notifications", onAction }: {
  title: string; subtitle?: string; action?: "none" | "notifications" | "plus"; onAction?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const actionName = action === "plus" ? "plus" : "bell";
  return (
    <View style={[styles.header, { paddingTop: insets.top, paddingBottom: 8 }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.workspaceLabel}>WORKSPACE</Text>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <Pressable style={styles.headerIconButton} accessibilityRole="button" accessibilityLabel={action === "plus" ? "Add" : "Notifications"} onPress={onAction}>
          <Icon name={actionName} size={22} color={colors.muted} />
        </Pressable>
        <Pressable style={styles.headerAvatar} accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push("/settings")}>
          <Text style={styles.headerAvatarText}>AC</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}
export function Money({ value, size = 24 }: { value: number; size?: number }) {
  const prefix = value < 0 ? "-₹" : "₹";
  return <Text style={[styles.money, { fontSize: size, color: value < 0 ? colors.danger : value > 0 ? colors.primary : colors.text }]}>{prefix}{Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</Text>;
}
export function SmallText({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return <Text style={[styles.smallText, danger && { color: colors.danger }]}>{children}</Text>;
}
export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "danger" | "warning" | "info" }) {
  const palette = { neutral: [colors.surfaceRaised, colors.muted], success: [colors.primarySoft, colors.primary], danger: [colors.dangerSoft, colors.danger], warning: [colors.warningSoft, colors.warning], info: [colors.infoSoft, colors.info] } as const;
  const selected = palette[tone];
  return <View style={[styles.pill, { backgroundColor: selected[0] }]}><Text style={[styles.pillText, { color: selected[1] }]}>{children}</Text></View>;
}
export function ProgressBar({ value, max = 100, tone = "primary" }: { value: number; max?: number; tone?: "primary" | "danger" | "warning" | "info" }) {
  const fill = tone === "danger" ? colors.danger : tone === "warning" ? colors.warning : tone === "info" ? colors.info : colors.primary;
  return <View style={styles.progressTrack}><View style={[styles.progressFill, { width: (Math.min(100, Math.max(0, (value / max) * 100)) + "%") as DimensionValue, backgroundColor: fill }]} /></View>;
}
export function Button({ title, onPress, kind = "primary", loading = false, disabled = false }: {
  title: string; onPress: () => void; kind?: "primary" | "secondary" | "danger"; loading?: boolean; disabled?: boolean;
}) {
  return <Pressable
    disabled={disabled || loading}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ disabled: disabled || loading, busy: loading }}
    style={({ pressed }) => [styles.button, kind === "secondary" && styles.buttonSecondary, kind === "danger" && styles.buttonDanger, (disabled || loading) && { opacity: 0.48 }, pressed && { opacity: 0.8 }]}
  >
    {loading ? <ActivityIndicator color={kind === "primary" ? colors.onAccent : colors.text} /> : <Text style={[styles.buttonText, kind !== "primary" && { color: kind === "danger" ? colors.danger : colors.text }]}>{title}</Text>}
  </Pressable>;
}
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search",
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchField}>
      <Icon name="search" size={18} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessible
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        selectionColor={colors.primary}
        style={styles.searchInput}
      />
    </View>
  );
}

export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}</Text><TextInput {...props} accessible accessibilityRole="textbox" placeholderTextColor={colors.muted} selectionColor={colors.primary} style={[styles.input, props.style]} /></View>;
}
export function ChipRow({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (value: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{values.map((value) => {
    const active = selected === value;
    return <Pressable key={value} onPress={() => onSelect(value)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{value}</Text>
    </Pressable>;
  })}</ScrollView>;
}
export function LoadingState() {
  return <View style={styles.loadingState} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} /><Text style={styles.smallText}>Loading FinanceAI…</Text></View>;
}
export function EmptyState({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Icon name="transactions" size={24} color={colors.subtle} /></View><Text style={styles.emptyText}>{message}</Text>{actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} kind="secondary" /> : null}</View>;
}
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite"><Icon name="warning" size={18} color={colors.danger} /><Text style={styles.errorText}>{message}</Text>{onRetry ? <Pressable onPress={onRetry} accessibilityRole="button"><Text style={styles.retryText}>Retry</Text></Pressable> : null}</View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, gap: 12 },
  header: { backgroundColor: colors.background, paddingHorizontal: 16 },
  headerRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 8 },
  titleBlock: { flex: 1, minWidth: 0 },
  workspaceLabel: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "600", letterSpacing: 0.2 },
  title: { color: colors.text, fontSize: 20, lineHeight: 29, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 1 },
  headerIconButton: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  headerAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  headerAvatarText: { color: colors.primary, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, gap: 10 },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "700" },
  money: { color: colors.text, fontWeight: "700" },
  smallText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  pill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  progressTrack: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.surfaceNegative, borderWidth: 1, borderColor: "rgba(240,68,68,0.35)" },
  buttonText: { color: colors.onAccent, fontWeight: "700", fontSize: 14, lineHeight: 20 },
  inputGroup: { gap: 6 },
  inputLabel: { color: colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  searchField: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, lineHeight: 22, paddingVertical: 10 },
  input: { minHeight: 48, color: colors.text, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, fontSize: 15, lineHeight: 22 },
  chipRow: { gap: 8, paddingVertical: 1 },
  chip: { minHeight: 44, minWidth: 44, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.surfacePositive, borderColor: colors.primary },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.primary },
  loadingState: { minHeight: 240, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyState: { alignItems: "center", justifyContent: "center", minHeight: 170, gap: 12 },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.muted, textAlign: "center", lineHeight: 20 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceNegative, borderColor: "rgba(240,68,68,0.35)", borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 },
  retryText: { color: colors.danger, fontSize: 12, fontWeight: "700", paddingHorizontal: 4 },
});
export { Icon };
