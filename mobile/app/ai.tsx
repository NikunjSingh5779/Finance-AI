import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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

  const send = async () => {
    const trimmed = question.trim();
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
              {message.role === "user" ? (
                <Text style={styles.messageText}>{message.content}</Text>
              ) : (
                <FormattedAIMessage content={message.content} />
              )}
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
  formattedMessage: {
    gap: 7,
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
