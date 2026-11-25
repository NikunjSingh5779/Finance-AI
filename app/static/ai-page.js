function latexToPlainText(value) {
  let text = String(value ?? "");
  text = text.replace(/\\text\s*\{([^{}]*)\}/g, "$1");
  for (let i = 0; i < 5; i += 1) {
    const next = text.replace(
      /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      "($1) / ($2)",
    );
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\times\b/g, "×")
    .replace(/\\cdot\b/g, "·")
    .replace(/\\div\b/g, "÷")
    .replace(/\\approx\b/g, "≈")
    .replace(/\\geq?\b/g, "≥")
    .replace(/\\leq?\b/g, "≤")
    .replace(/\\%/g, "%")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAiMarkdown(markdown) {
  let source = String(markdown ?? "").replace(/\r\n?/g, "\n");
  source = source
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, formula) => {
      return "\n\n" + latexToPlainText(formula) + "\n\n";
    })
    .replace(/\\\(([^]*?)\\\)/g, (_, formula) => {
      return latexToPlainText(formula);
    });
  source = source
    .replace(/[ \t]+---[ \t]+(?=#{1,4}\s)/g, "\n\n---\n\n")
    .replace(/([^\n])\s+(?=#{1,4}\s)/g, "$1\n\n");
  return source
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createAIPage({ $, apiFetch, apiResponse, showToast }) {
  let activeAIConversationId = null;
  let aiHistoryItems = [];
  let aiChatGeneration = 0;
  let aiSending = false;
  let initialized = false;
  function appendInlineMarkdown(parent, text) {
    const source = String(text ?? "")
      .replace(/\\\\([*_])/g, "$1")
      .replace(/\\\*\\\*/g, "**")
      .replace(/\\\*/g, "*");

    const pattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\x60[^\x60]+\x60)/g;
    let last = 0;
    let match;

    while ((match = pattern.exec(source))) {
      if (match.index > last) {
        parent.appendChild(document.createTextNode(source.slice(last, match.index)));
      }

      const token = match[0];
      let node;
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) {
        node = document.createElement("a");
        node.className = "ai-source-link";
        node.href = link[2];
        node.target = "_blank";
        node.rel = "noopener noreferrer";
        node.textContent = link[1];
      } else if (token.startsWith("**") || token.startsWith("__")) {
        node = document.createElement("strong");
        node.className = "ai-highlight";
        node.textContent = token.slice(2, -2);
      } else if (token.startsWith("\x60")) {
        node = document.createElement("code");
        node.textContent = token.slice(1, -1);
      } else {
        node = document.createElement("em");
        node.textContent = token.slice(1, -1);
      }

      parent.appendChild(node);
      last = pattern.lastIndex;
    }

    if (last < source.length) {
      parent.appendChild(document.createTextNode(source.slice(last)));
    }
  }

  function parseTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  }

  function isTableSeparator(line, columnCount) {
    const cells = parseTableRow(line);
    return cells.length === columnCount
      && cells.length >= 2
      && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function renderAiMarkdown(container, markdown) {
    container.classList.add("ai-markdown");
    while (container.firstChild) container.removeChild(container.firstChild);
    const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
    let list = null;
    let listType = null;

    const resetList = () => { list = null; listType = null; };
    const ensureList = (ordered) => {
      if (list && listType === (ordered ? "ol" : "ul")) return list;
      resetList();
      list = document.createElement(ordered ? "ol" : "ul");
      list.className = "ai-list";
      container.appendChild(list);
      listType = ordered ? "ol" : "ul";
      return list;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) { resetList(); continue; }

      const headerCells = trimmed.includes("|") ? parseTableRow(trimmed) : [];
      if (
        headerCells.length >= 2
        && i + 1 < lines.length
        && isTableSeparator(lines[i + 1], headerCells.length)
      ) {
        resetList();
        const table = document.createElement("table");
        table.className = "ai-table";
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        headerCells.forEach(cellText => {
          const cell = document.createElement("th");
          appendInlineMarkdown(cell, cellText);
          headerRow.appendChild(cell);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        i += 1;
        const tbody = document.createElement("tbody");
        while (
          i + 1 < lines.length
          && lines[i + 1].includes("|")
          && parseTableRow(lines[i + 1]).length === headerCells.length
          && !isTableSeparator(lines[i + 1], headerCells.length)
        ) {
          i += 1;
          const row = document.createElement("tr");
          parseTableRow(lines[i]).forEach(cellText => {
            const cell = document.createElement("td");
            appendInlineMarkdown(cell, cellText);
            row.appendChild(cell);
          });
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        container.appendChild(table);
        continue;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        resetList();
        const level = Math.min(3, heading[1].length);
        const element = document.createElement("h" + level);
        appendInlineMarkdown(element, heading[2]);
        container.appendChild(element);
        continue;
      }

      if (/^-{3,}$/.test(trimmed)) {
        resetList();
        container.appendChild(document.createElement("hr"));
        continue;
      }

      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        const currentList = ensureList(false);
        const item = document.createElement("li");
        appendInlineMarkdown(item, bullet[1]);
        currentList.appendChild(item);
        continue;
      }

      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (ordered) {
        const currentList = ensureList(true);
        const item = document.createElement("li");
        appendInlineMarkdown(item, ordered[1]);
        currentList.appendChild(item);
        continue;
      }

      const quote = trimmed.match(/^>\s?(.*)$/);
      if (quote) {
        resetList();
        const blockquote = document.createElement("blockquote");
        appendInlineMarkdown(blockquote, quote[1]);
        container.appendChild(blockquote);
        continue;
      }

      resetList();
      const paragraph = document.createElement("p");
      appendInlineMarkdown(paragraph, trimmed);
      container.appendChild(paragraph);
    }
  }

  function quickAsk(text) {
    $("chat-input").value = text;
    sendChat();
  }

  async function startNewAIChat() {
    aiChatGeneration += 1;
    activeAIConversationId = null;
    const chat = $("chat-msgs");
    if (chat) {
      chat.replaceChildren();
      appendSavedChatMessage("ai", "👋 Hi! I'm FinanceAI. How can I help you today?");
    }
    if ($("ai-history-panel")) $("ai-history-panel").hidden = true;
  }

  function renderAIHistory(items) {
    const list = $("ai-history-list");
    if (!list) return;
    list.replaceChildren();
    const query = ($("ai-history-search")?.value || "").trim().toLowerCase();
    const filtered = items.filter(item =>
      String(item.title || "").toLowerCase().includes(query)
      || String(item.last_message || "").toLowerCase().includes(query)
    );
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "ai-history-empty";
      empty.textContent = query ? "No matching conversations." : "No saved conversations yet.";
      list.appendChild(empty);
      return;
    }
    filtered.forEach(item => {
      const row = document.createElement("div");
      row.className = "ai-history-item";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "ai-history-open";
      const title = document.createElement("span");
      title.className = "ai-history-item-title";
      title.textContent = item.title || "New chat";
      const preview = document.createElement("span");
      preview.className = "ai-history-item-preview";
      preview.textContent = item.last_message || "No messages yet";
      open.append(title, preview);
      open.addEventListener("click", () => void resumeAIConversation(item.id));
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "ai-history-item-action";
      rename.textContent = "Rename";
      rename.addEventListener("click", () => void renameAIConversation(item));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ai-history-item-action";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => void deleteAIConversation(item.id));
      row.append(open, rename, remove);
      list.appendChild(row);
    });
  }

  async function openAIHistory() {
    const panel = $("ai-history-panel");
    if (!panel) return;
    panel.hidden = false;
    try {
      const result = await apiFetch("/api/conversations");
      aiHistoryItems = result.items || [];
      renderAIHistory(aiHistoryItems);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load chat history.", "error");
    }
  }

  async function resumeAIConversation(conversationId) {
    const generation = ++aiChatGeneration;
    try {
      const result = await apiFetch("/api/conversations/" + conversationId);
      if (generation !== aiChatGeneration) return;
      activeAIConversationId = result.conversation.id;
      const chat = $("chat-msgs");
      if (chat) chat.replaceChildren();
      (result.messages || []).forEach(message => {
        appendSavedChatMessage(message.role === "user" ? "user" : "ai", message.content);
      });
      if (!result.messages?.length) appendSavedChatMessage("ai", "👋 Hi! I'm FinanceAI. How can I help you today?");
      if ($("ai-history-panel")) $("ai-history-panel").hidden = true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open this conversation.", "error");
    }
  }

  async function renameAIConversation(item) {
    const title = window.prompt("Rename conversation", item.title || "New chat");
    if (!title || !title.trim()) return;
    try {
      await apiFetch("/api/conversations/" + item.id, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: title.trim()}),
      });
      await openAIHistory();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not rename this conversation.", "error");
    }
  }

  async function deleteAIConversation(conversationId) {
    if (!window.confirm("Delete this conversation and all its messages?")) return;
    try {
      await apiFetch("/api/conversations/" + conversationId, {method: "DELETE"});
      aiHistoryItems = aiHistoryItems.filter(item => item.id !== conversationId);
      renderAIHistory(aiHistoryItems);
      if (activeAIConversationId === conversationId) await startNewAIChat();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not delete this conversation.", "error");
    }
  }

  function appendSavedChatMessage(role, content) {
    const chat = $("chat-msgs");
    if (!chat) return;
    const wrapper = document.createElement("div");
    wrapper.className = "chat-msg " + role;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + role;
    if (role === "ai") renderAiMarkdown(bubble, content);
    else bubble.textContent = content;
    wrapper.appendChild(bubble);
    chat.appendChild(wrapper);
    chat.scrollTop = chat.scrollHeight;
  }

  async function streamConversationReply(conversationId, question, onDelta) {
    const response = await apiResponse("/api/conversations/" + conversationId + "/messages/stream", {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "text/event-stream"},
      body: JSON.stringify({question}),
    });
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      const error = new Error(payload.detail || response.statusText || "AI is unavailable.");
      error.status = response.status;
      throw error;
    }
    if (!response.body) {
      throw new Error("The browser could not read the AI response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload = null;

    const consumeEvent = block => {
      let eventName = "message";
      const dataLines = [];
      block.split("\n").forEach(line => {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      });
      if (!dataLines.length) return;

      let payload;
      try { payload = JSON.parse(dataLines.join("\n")); } catch (_) { return; }
      if (eventName === "delta" && typeof payload.text === "string") {
        onDelta(payload.text);
      } else if (eventName === "done") {
        donePayload = payload;
      } else if (eventName === "error") {
        throw new Error(payload.detail || "AI is unavailable.");
      }
    };

    const consumeBufferedEvents = () => {
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consumeEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    };

    while (true) {
      const {value, done} = await reader.read();
      if (value) {
        buffer += decoder.decode(value, {stream: !done}).replace(/\r/g, "");
        consumeBufferedEvents();
      }
      if (done) break;
    }
    buffer += decoder.decode().replace(/\r/g, "");
    if (buffer.trim()) consumeEvent(buffer);
    if (!donePayload) {
      throw new Error("The AI response ended before it was complete.");
    }
    return donePayload;
  }

  async function sendChat() {
    const input = $("chat-input");
    const chat = $("chat-msgs");
    const message = input?.value.trim() || "";
    if (!message || !chat || aiSending) return;
    aiSending = true;
    const generation = aiChatGeneration;
    appendSavedChatMessage("user", message);
    input.value = "";

    const typing = document.createElement("div");
    typing.className = "chat-msg ai";
    typing.id = "typing";
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble ai";
    bubble.textContent = "I'm working on your question...";
    typing.appendChild(bubble);
    chat.appendChild(typing);
    chat.scrollTop = chat.scrollHeight;

    try {
      let targetConversationId = activeAIConversationId;
      if (!targetConversationId) {
        const created = await apiFetch("/api/conversations", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({title: "New chat"}),
        });
        targetConversationId = created.conversation.id;
        if (generation === aiChatGeneration) {
          activeAIConversationId = targetConversationId;
        }
      }
      let reply = "";
      let animationFrame = 0;
      const renderStream = () => {
        animationFrame = 0;
        const wordCount = reply.trim() ? reply.trim().split(/\s+/).length : 0;
        bubble.textContent = wordCount
          ? `Preparing a formatted answer… ${wordCount} words received`
          : "Preparing a formatted answer…";
        chat.scrollTop = chat.scrollHeight;
      };
      const appendDelta = delta => {
        reply += delta;
        if (!animationFrame) animationFrame = requestAnimationFrame(renderStream);
      };

      try {
        const result = await streamConversationReply(
          targetConversationId,
          message,
          appendDelta,
        );
        if (!reply && typeof result.reply === "string") reply = result.reply;
      } catch (streamError) {
        // During a rolling deployment, an already cached frontend can briefly
        // reach an API version without the stream route. Keep the old endpoint
        // usable for that case.
        if (streamError?.status !== 404) throw streamError;
        const result = await apiFetch("/api/conversations/" + targetConversationId + "/messages", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({question: message}),
        });
        reply = result.reply || "No response";
      }

      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (reply) renderAiMarkdown(bubble, reply);
      if (generation === aiChatGeneration && activeAIConversationId === targetConversationId) {
        typing.removeAttribute("id");
        chat.scrollTop = chat.scrollHeight;
      } else {
        typing.remove();
      }
    } catch (error) {
      typing.remove();
      if (generation === aiChatGeneration) {
        appendSavedChatMessage("ai", "⚠️ " + (error instanceof Error ? error.message : "AI is unavailable."));
      }
    } finally {
      aiSending = false;
    }
  }


  function activateAIPage({ startNewChat: resetChat = true } = {}) {
    if (!initialized) {
      $("ai-history-toggle")?.addEventListener("click", openAIHistory);
      $("ai-history-close")?.addEventListener("click", () => {
        if ($("ai-history-panel")) $("ai-history-panel").hidden = true;
      });
      $("ai-new-chat")?.addEventListener("click", () => void startNewAIChat());
      $("ai-history-search")?.addEventListener("input", () => renderAIHistory(aiHistoryItems));
      initialized = true;
    }
    if (resetChat) void startNewAIChat();
  }

  return { activateAIPage, quickAsk, sendChat };
}
