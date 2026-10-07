import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SmallText,
} from "../src/components";
import { useFinance } from "../src/AppContext";
import type { ChatMessage } from "../src/types";
import { colors } from "../src/theme";

function cleanInline(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function FormattedAIMessage({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const clearChat = () => {
    Alert.alert("Clear chat", "Remove the current AI conversation?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () =>
          setMessages([{
            role: "assistant",
            content: "Hello! I've analyzed your recent financial activity. Ask me anything about spending, budgets, savings or goals.",
          }]),
      },
    ]);
  };

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages, sending]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.personalLabel}>PERSONAL AI</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Assistant</Text>
            <View style={styles.statusDot} />
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable onPress={clearChat} style={styles.headerIconButton} accessibilityLabel="Clear chat">
            <Text style={styles.headerIcon}>⌫</Text>
          </Pressable>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>AC</Text>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messagesScroll}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((message, index) => {
          const user = message.role === "user";
          return (
            <View key={message.role + "-" + index} style={[styles.messageRow, user ? styles.userRow : styles.aiRow]}>
              {!user ? (
                <View style={styles.aiSpark}>
                  <Text style={styles.aiSparkText}>✦</Text>
                </View>
              ) : null}

              <View style={[styles.messageBubble, user ? styles.userBubble : styles.aiBubble]}>
                {user ? (
                  <Text style={styles.userText}>{message.content}</Text>
                ) : (
                  <FormattedAIMessage content={message.content} />
                )}
              </View>
            </View>
          );
        })}

        {sending ? (
          <View style={[styles.messageRow, styles.aiRow]}>
            <View style={styles.aiSpark}><Text style={styles.aiSparkText}>✦</Text></View>
            <View style={[styles.messageBubble, styles.aiBubble]}>
              <View style={styles.typingRow}>
                <View style={styles.typingDot} />
                <View style={styles.typingDot} />
                <View style={styles.typingDot} />
              </View>
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickRow}
      >
        {[
          ["Analyze subscriptions", "Analyze my recurring expenses"],
          ["Savings goal progress", "How are my savings goals doing?"],
          ["Search latest finance news", "search latest finance news"],
        ].map(([label, prompt]) => (
          <Pressable
            key={label}
            onPress={() => void sendPrompt(prompt)}
            disabled={sending}
            style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.quickChipText}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.composerRow}>
        <View style={styles.composer}>
          <Text style={styles.composerIcon}>⌕</Text>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={() => void sendPrompt()}
            placeholder="Ask about your finances..."
            placeholderTextColor={colors.subtle}
            style={styles.input}
            maxLength={1000}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => void sendPrompt()}
            disabled={sending || question.trim().length < 3}
            style={[styles.sendButton, (sending || question.trim().length < 3) && styles.sendDisabled]}
          >
            {sending ? <ActivityIndicator color={colors.background} size="small" /> : <Text style={styles.sendIcon}>↑</Text>}
          </Pressable>
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={[styles.providerDot, { backgroundColor: providerReady ? colors.primary : colors.warning }]} />
        <Text style={styles.footerText}>{providerReady ? "AI connected" : "AI provider unavailable"}</Text>
        <Text style={styles.footerDot}>•</Text>
        <Text style={styles.footerText}>Financial decision support</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 72,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  personalLabel: { color: colors.subtle, fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  title: { color: colors.text, fontSize: 19, fontWeight: "900" },
  statusDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: colors.primary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIconButton: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerIcon: { color: colors.muted, fontSize: 16 },
  avatar: { width: 30, height: 30, borderRadius: 999, backgroundColor: "rgba(34,197,94,.16)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontSize: 9, fontWeight: "900" },
  messagesScroll: { flex: 1 },
  messagesContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 12 },
  messageRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  aiRow: { justifyContent: "flex-start" },
  userRow: { justifyContent: "flex-end" },
  aiSpark: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginTop: 2 },
  aiSparkText: { color: colors.primary, fontSize: 14 },
  messageBubble: { borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11 },
  aiBubble: { maxWidth: "86%", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderTopLeftRadius: 4 },
  userBubble: { maxWidth: "82%", backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong, borderRadius: 14, borderTopRightRadius: 4 },
  userText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  formattedMessage: { gap: 7 },
  headingLine: { gap: 5 },
  aiHeading: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  aiBodyInline: { color: colors.text, fontSize: 13, lineHeight: 19 },
  aiBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  bulletDot: { color: colors.primary, fontSize: 14, lineHeight: 19 },
  typingRow: { flexDirection: "row", gap: 4, paddingVertical: 3 },
  typingDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: colors.subtle },
  errorText: { color: colors.danger, fontSize: 10, paddingHorizontal: 10 },
  quickRow: { gap: 8, paddingHorizontal: 16, paddingTop: 7, paddingBottom: 8 },
  quickChip: { minHeight: 34, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  quickChipText: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  composerRow: { paddingHorizontal: 16, paddingBottom: 6 },
  composer: { minHeight: 48, borderRadius: 15, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", paddingLeft: 11, paddingRight: 7 },
  composerIcon: { color: colors.subtle, fontSize: 15, width: 20 },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, paddingVertical: 10 },
  sendButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.35 },
  sendIcon: { color: colors.background, fontSize: 17, fontWeight: "900" },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingBottom: 5 },
  providerDot: { width: 5, height: 5, borderRadius: 999 },
  footerText: { color: colors.subtle, fontSize: 8 },
  footerDot: { color: colors.borderStrong, fontSize: 8 },
  userWrap: {
    width: "100%",
    alignItems: "stretch",
  },
  assistantWrap: {
    width: "100%",
    alignItems: "stretch",
  },
  userCard: {
    width: "100%",
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
  },
  assistantCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
  },
  userMessageText: {
    color: colors.background,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  quickRow: {
    gap: 8,
    paddingVertical: 2,
  },
  quickButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  quickText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  composer: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-end",
  },
  textInput: {
    flex: 1,
    minHeight: 50,
    maxHeight: 130,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  sendButton: {
    minWidth: 70,
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: {
    color: colors.background,
    fontWeight: "900",
  },
  formattedMessage: {
    gap: 8,
  },
  headingLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    flexWrap: "wrap",
  },
  aiHeading: {
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "800",
  },
  aiBodyInline: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  aiBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletDot: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
  },
});
