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
import { useFinance } from "../src/AppContext";
import type { ChatMessage } from "../src/types";
import { colors } from "../src/theme";

const START_MESSAGE =
  "Hello Alex! I've analyzed your recent financial activity. Ask me anything about spending, budgets, savings or goals.";

function cleanInline(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
}

function FormattedAIMessage({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");

  return (
    <View style={styles.formattedMessage}>
      {lines.map((line, index) => {
        const text = line.trim();
        if (!text) return <View key={index} style={{ height: 4 }} />;

        const heading = text.match(/^\*\*(Summary|Key points|Next step):\*\*\s*(.*)$/i);
        if (heading) {
          return (
            <View key={index} style={styles.headingBlock}>
              <Text style={styles.aiHeading}>{heading[1]}</Text>
              {heading[2] ? <Text style={styles.aiBody}>{cleanInline(heading[2])}</Text> : null}
            </View>
          );
        }

        const bullet = text.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.aiBody}>{cleanInline(bullet[1])}</Text>
            </View>
          );
        }

        return (
          <Text key={index} style={styles.aiBody}>
            {cleanInline(text)}
          </Text>
        );
      })}
    </View>
  );
}

export default function AIScreen() {
  const { api, ready } = useFinance();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: START_MESSAGE },
  ]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const checkProvider = useCallback(async () => {
    if (!ready) return;
    try {
      const info = await api.aiProviders();
      setProviderReady(Object.keys(info).length > 0);
    } catch {
      setProviderReady(false);
    }
  }, [api, ready]);

  useEffect(() => {
    void checkProvider();
  }, [checkProvider]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages, sending]);

  const sendPrompt = async (preset?: string) => {
    const trimmed = (preset ?? question).trim();
    if (trimmed.length < 3 || sending) return;

    setSending(true);
    setError("");

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const nextMessages = messages.concat(userMessage);
    setMessages(nextMessages);
    setQuestion("");

    try {
      const response = await api.chat(
        trimmed,
        nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      );
      setMessages((current) =>
        current.concat({ role: "assistant", content: response.reply }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    Alert.alert("Clear chat", "Remove the current AI conversation?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => setMessages([{ role: "assistant", content: START_MESSAGE }]),
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>PERSONAL AI</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Assistant</Text>
            <View
              style={[
                styles.statusDot,
                providerReady === false && { backgroundColor: colors.warning },
              ]}
            />
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable onPress={clearChat} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>⌫</Text>
          </Pressable>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>AC</Text>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          return (
            <View
              key={message.role + "-" + index}
              style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}
            >
              {!isUser ? (
                <View style={styles.aiIcon}>
                  <Text style={styles.aiIconText}>✦</Text>
                </View>
              ) : null}

              <View
                style={[
                  styles.messageBubble,
                  isUser ? styles.userBubble : styles.aiBubble,
                ]}
              >
                {isUser ? (
                  <Text style={styles.userText}>{message.content}</Text>
                ) : (
                  <FormattedAIMessage content={message.content} />
                )}
              </View>
            </View>
          );
        })}

        {sending ? (
          <View style={styles.messageRow}>
            <View style={styles.aiIcon}>
              <Text style={styles.aiIconText}>✦</Text>
            </View>
            <View style={styles.typingBubble}>
              <View style={styles.typingDots}>
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
            disabled={sending}
            onPress={() => void sendPrompt(prompt)}
            style={styles.quickChip}
          >
            <Text style={styles.quickText}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <Text style={styles.searchIcon}>⌕</Text>
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
            style={[
              styles.sendButton,
              (sending || question.trim().length < 3) && styles.sendDisabled,
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Text style={styles.sendText}>↑</Text>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        <View
          style={[
            styles.footerDot,
            { backgroundColor: providerReady ? colors.primary : colors.warning },
          ]}
        />
        <Text style={styles.footerText}>
          {providerReady ? "AI connected" : "AI provider unavailable"}
        </Text>
        <Text style={styles.footerDivider}>•</Text>
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
  kicker: { color: colors.subtle, fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  title: { color: colors.text, fontSize: 19, fontWeight: "900" },
  statusDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: colors.primary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerButton: {
    width: 34, height: 34, borderRadius: 9, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  headerButtonText: { color: colors.muted, fontSize: 16 },
  avatar: {
    width: 30, height: 30, borderRadius: 99, backgroundColor: "rgba(34,197,94,.16)",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 9, fontWeight: "900" },
  messages: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 10, gap: 12 },
  messageRow: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 9 },
  aiRow: { justifyContent: "flex-start" },
  userRow: { justifyContent: "flex-end" },
  aiIcon: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  aiIconText: { color: colors.primary, fontSize: 14, fontWeight: "900" },
  messageBubble: { borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11 },
  aiBubble: {
    width: "82%", backgroundColor: colors.surface, borderColor: colors.border,
    borderRadius: 14, borderTopLeftRadius: 5,
  },
  userBubble: {
    maxWidth: "79%", backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong,
    borderRadius: 14, borderTopRightRadius: 5,
  },
  userText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  formattedMessage: { gap: 8 },
  headingBlock: { gap: 4 },
  aiHeading: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  aiBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  bulletDot: { color: colors.primary, fontSize: 14, lineHeight: 19 },
  typingBubble: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, borderTopLeftRadius: 5, paddingHorizontal: 15, paddingVertical: 13,
  },
  typingDots: { flexDirection: "row", gap: 4 },
  typingDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: colors.subtle },
  errorText: { color: colors.danger, fontSize: 10, paddingLeft: 39 },
  quickRow: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  quickChip: {
    minHeight: 34, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surfaceRaised,
    alignItems: "center", justifyContent: "center",
  },
  quickText: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  composerWrap: { paddingHorizontal: 16, paddingBottom: 6 },
  composer: {
    minHeight: 48, borderRadius: 15, backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.borderStrong, flexDirection: "row",
    alignItems: "center", paddingLeft: 10, paddingRight: 7,
  },
  searchIcon: { color: colors.subtle, fontSize: 15, width: 21 },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, paddingVertical: 10 },
  sendButton: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
  },
  sendDisabled: { opacity: 0.35 },
  sendText: { color: colors.background, fontSize: 17, fontWeight: "900" },
  footer: {
    minHeight: 18, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingBottom: 4,
  },
  footerDot: { width: 5, height: 5, borderRadius: 99 },
  footerText: { color: colors.subtle, fontSize: 8 },
  footerDivider: { color: colors.borderStrong, fontSize: 8 },
});
