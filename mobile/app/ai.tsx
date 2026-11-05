import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFinance } from "../src/AppContext";
import type { ChatMessage } from "../src/types";
import { colors } from "../src/theme";
import { Button, ChipRow, ErrorBanner, Header, Pill } from "../src/components";
import { Icon } from "../src/icons";
import type { AIConversation } from "../src/api";
import { useFocusEffect } from "expo-router";

const START_MESSAGE = "Hello Alex! I've analyzed your recent financial activity. Ask me anything about spending, budgets, savings or goals.";

const TOPICS: Array<[string, string]> = [
  ["Health", "How is my financial health?"],
  ["Spending", "What am I spending the most on?"],
  ["Savings", "How are my savings goals doing?"],
  ["Budget", "Am I on track with my budgets?"],
  ["Transactions", "Show my recent transactions."],
  ["News", "search latest finance news"],
];

function cleanInline(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
}
function sourceCount(content: string) {
  return new Set((content.match(/https?:\/\/[^\s)]+/g) || []).map((url) => url.replace(/[.,]+$/, ""))).size;
}

function FormattedAIMessage({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  return (
    <View style={styles.formattedMessage}>
      {lines.map((line, index) => {
        const value = line.trim();
        if (!value) return <View key={index} style={{ height: 4 }} />;
        const heading = value.match(/^\*\*(Summary|Key points|Next step):\*\*\s*(.*)$/i);
        if (heading) {
          return (
            <View key={index} style={styles.headingBlock}>
              <Text style={styles.aiHeading}>{heading[1]}</Text>
              {heading[2] ? <Text style={styles.aiBody}>{cleanInline(heading[2])}</Text> : null}
            </View>
          );
        }
        const bullet = value.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.aiBody}>{cleanInline(bullet[1] ?? "")}</Text>
            </View>
          );
        }
        return <Text key={index} style={styles.aiBody}>{cleanInline(value)}</Text>;
      })}
    </View>
  );
}

export default function AIScreen() {
  const { api, ready } = useFinance();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: START_MESSAGE }]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [historyItems, setHistoryItems] = useState<AIConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const checkProvider = useCallback(async () => {
    if (!ready) return;
    try {
      const info = await api.aiProviders();
      setProviderReady(Boolean(info.selected));
    } catch {
      setProviderReady(false);
    }
  }, [api, ready]);

  useEffect(() => { void checkProvider(); }, [checkProvider]);
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages, sending]);

  const startNewChat = useCallback(async () => {
    setHistoryOpen(false);
    setError("");
    setQuestion("");
    setMessages([{ role: "assistant", content: START_MESSAGE }]);
    setConversationId(null);
    if (!ready) return;
    try {
      const result = await api.createConversation();
      setConversationId(result.conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new chat.");
    }
  }, [api, ready]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const result = await api.conversations();
      setHistoryItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved conversations.");
    } finally {
      setHistoryLoading(false);
    }
  }, [api]);

  const resumeConversation = async (item: AIConversation) => {
    setHistoryLoading(true);
    try {
      const result = await api.getConversation(item.id);
      setConversationId(result.conversation.id);
      setMessages(result.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })));
      setHistoryOpen(false);
      setQuestion("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this conversation.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const removeConversation = (item: AIConversation) => {
    Alert.alert("Delete conversation", "This permanently deletes this chat and its messages.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void api.deleteConversation(item.id).then(async () => {
            setHistoryItems((current) => current.filter((entry) => entry.id !== item.id));
            if (conversationId === item.id) await startNewChat();
          }).catch((err) => setError(err instanceof Error ? err.message : "Could not delete the conversation."));
        },
      },
    ]);
  };

  useFocusEffect(useCallback(() => {
    void startNewChat();
    return undefined;
  }, [startNewChat]));

  const sendPrompt = async (preset?: string) => {
    const trimmed = (preset ?? question).trim();
    if (trimmed.length < 3 || sending) return;
    setSending(true);
    setError("");
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((current) => current.concat(userMessage));
    setQuestion("");

    try {
      let activeConversationId = conversationId;
      if (activeConversationId === null) {
        const created = await api.createConversation();
        activeConversationId = created.conversation.id;
        setConversationId(activeConversationId);
      }
      const response = await api.sendConversationMessage(activeConversationId, trimmed);
      setMessages((current) => current.concat({ role: "assistant", content: response.reply }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    Alert.alert("Clear chat", "Remove the current AI conversation?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => setMessages([{ role: "assistant", content: START_MESSAGE }]) },
    ]);
  };

  const toggleResearch = () => {
    const next = question.trimStart().startsWith("search ") ? question.trimStart().slice(7) : "search " + question.trim();
    setQuestion(next === "search " ? "search " : next);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Header title="Assistant" />
      <View style={styles.chatToolbar}>
        <Pressable onPress={() => void openHistory()} style={styles.historyButton} accessibilityRole="button">
          <Icon name="calendar" size={16} color={colors.primary} />
          <Text style={styles.historyButtonText}>History</Text>
        </Pressable>
        <Pressable onPress={() => void startNewChat()} style={styles.newChatButton} accessibilityRole="button">
          <Icon name="plus" size={16} color={colors.onAccent} />
          <Text style={styles.newChatButtonText}>New chat</Text>
        </Pressable>
      </View>

      {providerReady === false ? (
        <View style={styles.unavailableWrap}>
          <View style={styles.unavailableIcon}><Icon name="assistant" size={24} color={colors.warning} /></View>
          <Text style={styles.unavailableTitle}>AI model currently unavailable</Text>
          <Text style={styles.unavailableText}>AI model-backed answers need a configured provider. Live market facts can still be answered directly; check the backend provider configuration for research and advice.</Text>
          <Button title="Retry" onPress={() => void checkProvider()} kind="secondary" />
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.conversation}
        contentContainerStyle={styles.conversationContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const sources = isUser ? 0 : sourceCount(message.content);
          return (
            <View key={message.role + "-" + index} style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
              {!isUser ? (
                <View style={styles.aiAvatar}>
                  <Icon name="assistant" size={20} color={colors.primary} />
                </View>
              ) : null}
              <View style={[styles.messageColumn, isUser && styles.userColumn]}>
                <View style={[styles.metaRow, isUser && styles.userMetaRow]}>
                  {!isUser ? <Text style={styles.metaLabel}>FinanceAI</Text> : <Text style={styles.metaLabel}>You</Text>}
                  <Text style={styles.metaTime}>{index === 0 && !isUser ? "" : "Now"}</Text>
                  {!isUser && sources > 0 ? (
                    <View style={styles.sourceBadge}>
                      <Icon name="globe" size={10} color={colors.info} />
                      <Text style={styles.sourceText}>{sources} source{sources === 1 ? "" : "s"}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  {isUser ? <Text style={styles.userText}>{message.content}</Text> : <FormattedAIMessage content={message.content} />}
                </View>
              </View>
            </View>
          );
        })}

        {sending ? (
          <View style={styles.messageRow}>
            <View style={styles.aiAvatar}><ActivityIndicator color={colors.primary} /></View>
            <View style={styles.messageColumn}>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>FinanceAI</Text><Text style={styles.metaTime}>Thinking…</Text></View>
              <View style={styles.aiBubble}><View style={styles.typingDots}><View style={styles.typingDot} /><View style={styles.typingDot} /><View style={styles.typingDot} /></View></View>
            </View>
          </View>
        ) : null}

        {error ? <ErrorBanner message={error} onRetry={() => void checkProvider()} /> : null}
      </ScrollView>

      <View style={styles.suggested}>
        <Text style={styles.suggestedLabel}>Suggested topics</Text>
        <View style={styles.topicGrid}>
          {TOPICS.map(([label, prompt]) => (
            <Pressable
              key={label}
              onPress={() => void sendPrompt(prompt)}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={({ pressed }) => [styles.topicChip, pressed && { opacity: 0.75 }, sending && { opacity: 0.45 }]}
            >
              <Text style={styles.topicText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.composerArea}>
        <View style={[styles.composerInput, sending && { opacity: 0.6 }]}>
          <Icon name="edit" size={16} color={colors.muted} />
          <TextInput
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={() => void sendPrompt()}
            placeholder="Ask FinanceAI anything — money, travel, tech…"
            placeholderTextColor={colors.muted}
            editable={!sending}
            style={styles.input}
            maxLength={1000}
            returnKeyType="send"
            accessibilityLabel="Ask FinanceAI a question"
          />
        </View>
        <View style={styles.composerActions}>
          <Pressable
            onPress={toggleResearch}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel="Toggle web research"
            accessibilityState={{ disabled: sending }}
            style={styles.webButton}
          >
            <Icon name="globe" size={22} color={colors.muted} />
          </Pressable>
          <Pressable
            onPress={() => void sendPrompt()}
            disabled={sending || question.trim().length < 3}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: sending || question.trim().length < 3, busy: sending }}
            style={[styles.sendButton, (sending || question.trim().length < 3) && styles.sendDisabled]}
          >
            {sending ? <ActivityIndicator color={colors.onAccent} /> : <Icon name="send" size={22} color={colors.onAccent} />}
          </Pressable>
        </View>
      </View>
      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.historyBackdrop}>
          <View style={styles.historySheet}>
            <View style={styles.historySheetHeader}>
              <Text style={styles.historyTitle}>Saved conversations</Text>
              <Pressable onPress={() => setHistoryOpen(false)}><Icon name="close" size={22} color={colors.muted} /></Pressable>
            </View>
            {historyLoading ? <ActivityIndicator color={colors.primary} /> : null}
            <ScrollView>
              {historyItems.map((item) => (
                <View key={item.id} style={styles.historyItem}>
                  <Pressable style={styles.historyItemMain} onPress={() => void resumeConversation(item)}>
                    <Text style={styles.historyItemTitle}>{item.title}</Text>
                    <Text style={styles.historyItemPreview} numberOfLines={1}>{item.last_message || "No messages yet"}</Text>
                  </Pressable>
                  <Pressable onPress={() => removeConversation(item)}><Icon name="trash" size={18} color={colors.danger} /></Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  chatToolbar: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  historyButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 7 },
  historyButtonText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  newChatButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", gap: 7 },
  newChatButtonText: { color: colors.onAccent, fontSize: 12, fontWeight: "700" },
  historyBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.55)" },
  historySheet: { maxHeight: "78%", minHeight: 280, padding: 18, backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 14 },
  historySheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  historyTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  historyItem: { minHeight: 68, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 },
  historyItemMain: { flex: 1, minWidth: 0, paddingVertical: 10 },
  historyItemTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  historyItemPreview: { color: colors.muted, fontSize: 11, marginTop: 3 },
  historyDelete: { padding: 10 },
  conversation: { flex: 1 },
  conversationContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10, gap: 12 },
  messageRow: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 8 },
  aiRow: { justifyContent: "flex-start" },
  userRow: { justifyContent: "flex-end" },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginTop: 1 },
  messageColumn: { flex: 1, minWidth: 0 },
  userColumn: { flex: 0, maxWidth: "79%", alignItems: "flex-end" },
  metaRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 6 },
  userMetaRow: { justifyContent: "flex-end" },
  metaLabel: { color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: "600" },
  metaTime: { color: colors.subtle, fontSize: 11, lineHeight: 17 },
  sourceBadge: { minHeight: 23, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceInfo, borderRadius: 99, paddingHorizontal: 8 },
  sourceText: { color: colors.info, fontSize: 11, fontWeight: "600" },
  messageBubble: { borderWidth: 1, padding: 12, borderRadius: 14 },
  aiBubble: { width: "100%", backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: 6, minHeight: 73 },
  userBubble: { minWidth: 100, backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong, borderTopRightRadius: 6 },
  userText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  formattedMessage: { gap: 8 },
  headingBlock: { gap: 4 },
  aiHeading: { color: colors.primary, fontSize: 11, fontWeight: "700" },
  aiBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  bulletDot: { color: colors.primary, fontSize: 14, lineHeight: 19 },
  typingDots: { flexDirection: "row", gap: 4, paddingVertical: 3 },
  typingDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: colors.subtle },
  unavailableWrap: { marginHorizontal: 16, marginTop: 16, padding: 20, backgroundColor: colors.surfaceWarning, borderWidth: 1, borderColor: "rgba(245,168,0,.25)", borderRadius: 16, alignItems: "center", gap: 10 },
  unavailableIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.warningSoft, alignItems: "center", justifyContent: "center" },
  unavailableTitle: { color: colors.warning, fontSize: 16, fontWeight: "700" },
  unavailableText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  suggested: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  suggestedLabel: { color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  topicGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  topicChip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  topicText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  composerArea: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  composerInput: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 16 },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, lineHeight: 22, paddingVertical: 0 },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  webButton: { width: 44, height: 48, alignItems: "flex-start", justifyContent: "center" },
  sendButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
});
