import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  Card,
  ErrorBanner,
  Header,
  Pill,
  Screen,
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
  return (
    <View style={styles.formattedMessage}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={String(index)} style={{ height: 5 }} />;

        const heading = trimmed.match(/^\*\*(Summary|Key points|Next step):\*\*\s*(.*)$/i);
        if (heading) {
          return (
            <View key={String(index)} style={styles.headingLine}>
              <Text style={styles.aiHeading}>{heading[1]}:</Text>
              {heading[2] ? <Text style={styles.aiBodyInline}>{cleanInline(heading[2])}</Text> : null}
            </View>
          );
        }

        const bullet = trimmed.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <View key={String(index)} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.aiBody}>{cleanInline(bullet[1])}</Text>
            </View>
          );
        }

        return (
          <Text key={String(index)} style={styles.aiBody}>
            {cleanInline(trimmed)}
          </Text>
        );
      })}
    </View>
  );
}

function WebAIScreen({
  messages,
  question,
  setQuestion,
  sending,
  providerReady,
  error,
  onSend,
}: {
  messages: ChatMessage[];
  question: string;
  setQuestion: (value: string) => void;
  sending: boolean;
  providerReady: boolean | null;
  error: string;
  onSend: (value?: string) => void;
}) {
  const router = useRouter();

  const navigate = (path: string) => router.push(path as never);

  return (
    <View style={styles.webRoot}>
      <View style={styles.webSidebar}>
        <View style={styles.webBrand}>
          <View style={styles.webBrandIcon}><Text style={styles.webBrandEmoji}>💰</Text></View>
          <View>
            <Text style={styles.webBrandTitle}>FinanceAI</Text>
            <Text style={styles.webBrandSub}>Personal Finance</Text>
          </View>
        </View>

        <View style={styles.webNav}>
          {[
            ["⊞", "Overview", "/"],
            ["⇄", "Transactions", "/transactions"],
            ["◎", "Budgets", "/planning"],
          ].map(([glyph, label, path]) => (
            <Pressable key={label} onPress={() => navigate(path)} style={styles.webNavItem}>
              <Text style={styles.webNavIcon}>{glyph}</Text>
              <Text style={styles.webNavText}>{label}</Text>
            </Pressable>
          ))}

          <Text style={styles.webNavSection}>GENERAL</Text>

          <Pressable style={[styles.webNavItem, styles.webNavActive]}>
            <Text style={styles.webNavIcon}>✦</Text>
            <Text style={[styles.webNavText, styles.webNavTextActive]}>AI Assistant</Text>
          </Pressable>

          <Pressable onPress={() => navigate("/insights")} style={styles.webNavItem}>
            <Text style={styles.webNavIcon}>◈</Text>
            <Text style={styles.webNavText}>Financial Insights</Text>
          </Pressable>

          <Pressable onPress={() => navigate("/settings")} style={styles.webNavItem}>
            <Text style={styles.webNavIcon}>🌙</Text>
            <Text style={styles.webNavText}>Dark/light</Text>
          </Pressable>
        </View>

        <View style={styles.webUser}>
          <View style={styles.webAvatar}><Text style={styles.webAvatarText}>AC</Text></View>
          <View>
            <Text style={styles.webUserName}>Someone</Text>
            <Text style={styles.webUserSub}>Personal workspace</Text>
          </View>
        </View>
      </View>

      <View style={styles.webMain}>
        <View style={styles.webTopbar}>
          <View style={styles.webBreadcrumb}>
            <Text style={styles.webBreadcrumbMuted}>Workspace</Text>
            <Text style={styles.webBreadcrumbSep}>/</Text>
            <Text style={styles.webBreadcrumbCurrent}>AI Assistant</Text>
          </View>

          <View style={styles.webTopActions}>
            <View style={styles.webSearch}>
              <Text style={styles.webSearchIcon}>⌕</Text>
              <Text style={styles.webSearchText}>Search transactions, merchants...</Text>
              <Text style={styles.webKbd}>⌘K</Text>
            </View>
            <Pressable style={[styles.webTopBtn, styles.webTopBtnActive]}>
              <Text style={styles.webTopBtnText}>▣ This month</Text>
            </Pressable>
            <Pressable style={styles.webTopBtn}>
              <Text style={styles.webTopBtnText}>All</Text>
            </Pressable>
            <View style={styles.webBell}><Text>🔔</Text></View>
            <Pressable onPress={() => navigate("/transactions")} style={styles.webAddBtn}>
              <Text style={styles.webAddBtnText}>+ Add transaction</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.webChatArea}>
          <ScrollView
            style={styles.webMessages}
            contentContainerStyle={styles.webMessagesContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map((message, index) => {
              const user = message.role === "user";
              return (
                <View
                  key={message.role + "-" + index}
                  style={[styles.webMsgWrap, user ? styles.webMsgUser : styles.webMsgAI]}
                >
                  <View style={[styles.webBubble, user ? styles.webUserBubble : styles.webAIBubble]}>
                    {!user ? <Text style={styles.webMessageLabel}>FinanceAI</Text> : null}
                    {user ? (
                      <Text style={styles.webUserMessage}>{message.content}</Text>
                    ) : (
                      <FormattedAIMessage content={message.content} />
                    )}
                  </View>
                </View>
              );
            })}
            {sending ? (
              <View style={styles.webMsgWrap}>
                <View style={[styles.webBubble, styles.webAIBubble]}>
                  <View style={styles.webTyping}>
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                  </View>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.webQuickRow}>
            {[
              ["💚", "Health", "How is my financial health?"],
              ["📊", "Spending", "Show my spending analysis"],
              ["💰", "Savings", "How can I improve savings?"],
            ].map(([icon, label, prompt]) => (
              <Pressable
                key={label}
                style={styles.webQuickBtn}
                onPress={() => {
                  onSend(prompt);
                }}
              >
                <Text style={styles.webQuickIcon}>{icon}</Text>
                <Text style={styles.webQuickText}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.webComposerRow}>
            <View style={styles.webComposer}>
              <Text style={styles.webAttach}>⌕</Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                onSubmitEditing={onSend}
                placeholder="Ask about your budget, savings..."
                placeholderTextColor={colors.subtle}
                style={styles.webComposerInput}
                maxLength={1000}
                returnKeyType="send"
              />
              <Pressable
                disabled={sending || question.trim().length < 3}
                onPress={onSend}
                style={[
                  styles.webSendBtn,
                  (sending || question.trim().length < 3) && { opacity: 0.45 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.background} size="small" />
                ) : (
                  <Text style={styles.webSendText}>↑</Text>
                )}
              </Pressable>
            </View>
          </View>

          <Text style={styles.webDisclaimer}>
            AI is decision support. The backend is instructed not to invent transactions, balances, prices or guaranteed returns.
          </Text>

          {error ? (
            <View style={styles.webErrorWrap}><ErrorBanner message={error} /></View>
          ) : null}

          <View style={styles.webProviderRow}>
            <View style={styles.webProviderDot} />
            <Text style={styles.webProviderText}>
              {providerReady ? "AI provider connected" : "AI provider unavailable"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function AIScreen() {
  const { api, ready } = useFinance();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "I’m ready. Ask about your spending, budgets, goals, cash flow or financial health.",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const loadProviderStatus = useCallback(async () => {
    if (!ready) return;
    try {
      const info = await api.aiProviders();
      setProviderReady(Object.keys(info).length > 0);
    } catch {
      setProviderReady(false);
    }
  }, [api, ready]);

  useEffect(() => {
    void loadProviderStatus();
  }, [loadProviderStatus]);

  const send = async (preset?: string) => {
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
      setMessages((current) => current.concat({
        role: "assistant",
        content: response.reply,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setSending(false);
    }
  };

  if (Platform.OS === "web") {
    return (
      <WebAIScreen
        messages={messages}
        question={question}
        setQuestion={setQuestion}
        sending={sending}
        providerReady={providerReady}
        error={error}
        onSend={(preset) => void send(preset)}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <Header title="AI Assistant" subtitle="Uses the FinanceAI server-side financial context." />
        <View style={styles.statusRow}>
          <Pill tone={providerReady ? "success" : "warning"}>
            {providerReady ? "Provider available" : "Check provider"}
          </Pill>
          <SmallText>Provider secrets stay on the backend.</SmallText>
        </View>

        {error ? <ErrorBanner message={error} /> : null}

        {messages.map((message, index) => (
          <View
            key={message.role + "-" + index}
            style={message.role === "user" ? styles.userWrap : styles.assistantWrap}
          >
            <Card style={message.role === "user" ? styles.userCard : styles.assistantCard}>
              <SmallText>{message.role === "user" ? "You" : "FinanceAI"}</SmallText>
              <Text style={styles.messageText}>{message.content}</Text>
            </Card>
          </View>
        ))}

        <View style={{ height: 10 }} />
        <View style={styles.composer}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask: Where can I reduce spending?"
            placeholderTextColor={colors.muted}
            style={styles.textInput}
            multiline
            maxLength={1000}
          />
          <Pressable
            disabled={sending || question.trim().length < 3}
            onPress={() => void send()}
            style={({ pressed }) => [
              styles.sendButton,
              pressed && { opacity: 0.8 },
              (sending || question.trim().length < 3) && { opacity: 0.45 },
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.sendText}>Send</Text>
            )}
          </Pressable>
        </View>

        <SmallText>
          AI is decision support. The backend is instructed not to invent transactions, balances, prices or guaranteed returns.
        </SmallText>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Native/mobile styles
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userWrap: {
    alignItems: "flex-end",
  },
  assistantWrap: {
    alignItems: "flex-start",
  },
  userCard: {
    maxWidth: "92%",
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(34,197,94,0.30)",
  },
  assistantCard: {
    maxWidth: "96%",
  },
  messageText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
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

  // Desktop web shell matching the main FinanceAI frontend
  webRoot: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.background,
  },
  webSidebar: {
    width: 214,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    justifyContent: "flex-start",
  },
  webBrand: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  webBrandIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  webBrandEmoji: {
    fontSize: 14,
  },
  webBrandTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  webBrandSub: {
    color: colors.subtle,
    fontSize: 10,
    marginTop: 1,
  },
  webNav: {
    paddingTop: 10,
    paddingHorizontal: 8,
    gap: 2,
    flex: 1,
  },
  webNavItem: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  webNavActive: {
    backgroundColor: colors.surfaceRaised,
  },
  webNavIcon: {
    color: colors.muted,
    width: 18,
    fontSize: 15,
    textAlign: "center",
  },
  webNavText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  webNavTextActive: {
    color: colors.text,
    fontWeight: "600",
  },
  webNavSection: {
    color: colors.subtle,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 15,
    marginBottom: 3,
    paddingHorizontal: 10,
  },
  webUser: {
    minHeight: 70,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  webAvatar: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  webAvatarText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  webUserName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
  webUserSub: {
    color: colors.subtle,
    fontSize: 10,
    marginTop: 1,
  },
  webMain: {
    flex: 1,
    minWidth: 0,
  },
  webTopbar: {
    height: 56,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  webBreadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  webBreadcrumbMuted: {
    color: colors.subtle,
    fontSize: 12,
  },
  webBreadcrumbSep: {
    color: colors.subtle,
    fontSize: 12,
  },
  webBreadcrumbCurrent: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
  webTopActions: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
  },
  webSearch: {
    width: 260,
    height: 32,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    gap: 6,
  },
  webSearchIcon: {
    color: colors.subtle,
    fontSize: 14,
  },
  webSearchText: {
    flex: 1,
    color: colors.subtle,
    fontSize: 10,
  },
  webKbd: {
    color: colors.subtle,
    fontSize: 9,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  webTopBtn: {
    height: 32,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  webTopBtnActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  webTopBtnText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "600",
  },
  webBell: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  webAddBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  webAddBtnText: {
    color: colors.background,
    fontSize: 10,
    fontWeight: "800",
  },
  webChatArea: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.background,
  },
  webMessages: {
    flex: 1,
  },
  webMessagesContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 10,
  },
  webMsgWrap: {
    width: "100%",
  },
  webMsgAI: {
    alignItems: "flex-start",
  },
  webMsgUser: {
    alignItems: "flex-end",
  },
  webBubble: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  webAIBubble: {
    maxWidth: "76%",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  webUserBubble: {
    maxWidth: "76%",
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  webMessageLabel: {
    color: colors.muted,
    fontSize: 10,
    marginBottom: 5,
  },
  webUserMessage: {
    color: "#000",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  formattedMessage: {
    gap: 6,
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
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: "800",
  },
  aiBodyInline: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  aiBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletDot: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 18,
  },
  webTyping: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 3,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.subtle,
  },
  webQuickRow: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: "row",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  webQuickBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  webQuickIcon: {
    fontSize: 11,
  },
  webQuickText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  webComposerRow: {
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  webComposer: {
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 13,
    paddingRight: 7,
  },
  webAttach: {
    color: colors.subtle,
    fontSize: 14,
    width: 20,
  },
  webComposerInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    paddingVertical: 9,
    outlineStyle: "none" as never,
  },
  webSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  webSendText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "900",
  },
  webDisclaimer: {
    textAlign: "center",
    color: colors.subtle,
    fontSize: 9,
    paddingHorizontal: 20,
    paddingBottom: 3,
  },
  webProviderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 5,
  },
  webProviderDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  webProviderText: {
    color: colors.subtle,
    fontSize: 9,
  },
  webErrorWrap: {
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
});
