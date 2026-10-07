import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type RefreshControlProps,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { colors, radii, spacing } from "./theme";

export function Screen({
  children,
  refreshControl,
}: {
  children: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
export function Header({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.workspaceLabel}>WORKSPACE</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View style={styles.headerActions}>
        <Pressable style={styles.headerIconButton} accessibilityLabel="Notifications">
          <Text style={styles.headerIcon}>♧</Text>
        </Pressable>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>AC</Text>
        </View>
      </View>
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Money({ value, size = 24 }: { value: number; size?: number }) {
  const prefix = value < 0 ? "-₹" : "₹";
  return (
    <Text
      style={[
        styles.money,
        {
          fontSize: size,
          color: value < 0 ? colors.danger : value > 0 ? colors.primary : colors.text,
        },
      ]}
    >
      {prefix}
      {Math.abs(value).toLocaleString("en-IN", {
        maximumFractionDigits: 0,
      })}
    </Text>
  );
}

export function SmallText({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Text style={[styles.smallText, danger && { color: colors.danger }]}>
      {children}
    </Text>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "danger" | "warning" | "info";
}) {
  const palette = {
    neutral: [colors.surfaceRaised, colors.muted],
    success: [colors.primarySoft, colors.primary],
    danger: [colors.dangerSoft, colors.danger],
    warning: [colors.warningSoft, colors.warning],
    info: [colors.infoSoft, colors.info],
  } as const;
  const selected = palette[tone];
  return (
    <View style={[styles.pill, { backgroundColor: selected[0] }]}>
      <Text style={[styles.pillText, { color: selected[1] }]}>{children}</Text>
    </View>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone = "primary",
}: {
  value: number;
  max?: number;
  tone?: "primary" | "danger" | "warning" | "info";
}) {
  const fill =
    tone === "danger"
      ? colors.danger
      : tone === "warning"
        ? colors.warning
        : tone === "info"
          ? colors.info
          : colors.primary;

  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          {
            width: (Math.min(100, Math.max(0, (value / max) * 100)) + "%") as DimensionValue,
            backgroundColor: fill,
          },
        ]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === "secondary" && styles.buttonSecondary,
        kind === "danger" && styles.buttonDanger,
        (disabled || loading) && { opacity: 0.55 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === "primary" ? colors.background : colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            kind !== "primary" && { color: colors.text },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: spacing(1) }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

export function ChipRow({
  values,
  selected,
  onSelect,
}: {
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {values.map((value) => (
        <Pressable
          key={value}
          onPress={() => onSelect(value)}
          style={[
            styles.chip,
            selected === value && {
              backgroundColor: colors.primarySoftStrong,
              borderColor: colors.primary,
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              selected === value && { color: colors.primary },
            ]}
          >
            {value}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function LoadingState() {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.smallText}>Loading FinanceAI…</Text>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>◌</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 30,
    gap: 12,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  workspaceLabel: {
    color: colors.subtle,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: {
    color: colors.muted,
    fontSize: 17,
  },
  headerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: "800",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.subtle,
    fontSize: 11,
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: 14,
    gap: 9,
  },
  money: {
    color: colors.text,
    fontWeight: "800",
  },
  smallText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  progressTrack: {
    height: 5,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  button: {
    minHeight: 40,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: radii.input,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonDanger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.30)",
  },
  buttonText: {
    color: colors.background,
    fontWeight: "800",
    fontSize: 13,
  },
  inputLabel: {
    color: colors.subtle,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 42,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: 14,
    fontSize: 13,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  chipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  loadingState: {
    minHeight: 300,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 140,
    gap: 8,
  },
  emptyIcon: {
    color: colors.muted,
    fontSize: 34,
  },
  emptyText: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderColor: "#6a2630",
    borderWidth: 1,
    padding: 12,
    borderRadius: radii.input,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
});

export const commonStyles = styles;
