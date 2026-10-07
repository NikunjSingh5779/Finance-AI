(() => {
  "use strict";

  let currentPage = "dashboard";
  let selectedRange = "1Y";
  let isAllView = false;
  let editingTxnId = null;
  let editingAccountId = null;

  let txnsData = [];
  let budgetsData = [];
  let accountsData = [];
  let summaryData = {};
  let summaryAll = {};

  let cashflowChart = null;
  let catChartInst = null;
  const sparkCharts = {};

  const API = window.FINANCEAI_API_URL || "";
  const CAT_COLORS = [
    "#22c55e", "#f59e0b", "#3b82f6", "#ef4444",
    "#a855f7", "#f97316", "#06b6d4", "#84cc16"
  ];

  const $ = id => document.getElementById(id);

  function fmt(value) {
    const n = Number(value);
    return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
      maximumFractionDigits: 0
    });
  }

  function fmtDec(value) {
    const n = Number(value);
    return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  async function apiFetch(path, options = {}) {
    const response = await fetch(API + path, options);
    if (!response.ok) {
      let message = response.statusText || "Request failed";
      try {
        const payload = await response.json();
        if (Array.isArray(payload.detail)) {
          message = payload.detail.map(item => item.msg || JSON.stringify(item)).join("; ");
        } else {
          message = payload.detail || payload.message || message;
        }
      } catch (_) {
        // Keep HTTP status text.
      }
      throw new Error(message);
    }
    return response.json();
  }

  function showToast(message, type = "success") {
    let toast = $("app-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "app-toast";
      toast.style.cssText = [
        "position:fixed", "bottom:24px", "left:50%",
        "transform:translateX(-50%) translateY(80px)",
        "background:var(--bg3)", "color:var(--text)",
        "padding:10px 22px", "border-radius:10px",
        "font-size:13px", "z-index:9999",
        "transition:transform .3s ease,opacity .3s ease",
        "opacity:0", "pointer-events:none",
        "border:1px solid var(--border2)",
        "box-shadow:0 4px 20px rgba(0,0,0,.3)"
      ].join(";");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.borderColor = type === "error" ? "var(--red)" : "var(--green)";
    toast.style.color = type === "error" ? "var(--red)" : "var(--text)";
    toast.style.transform = "translateX(-50%) translateY(0)";
    toast.style.opacity = "1";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.transform = "translateX(-50%) translateY(80px)";
      toast.style.opacity = "0";
    }, 3200);
  }

  function appendInlineMarkdown(parent, text) {
    const source = String(text ?? "")
      .replace(/\\\\([*_])/g, "$1")
      .replace(/\\\*\\\*/g, "**")
      .replace(/\\\*/g, "*");

    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\`[^\`]+\`)/g;
    let last = 0;
    let match;

    while ((match = pattern.exec(source))) {
      if (match.index > last) {
        parent.appendChild(document.createTextNode(source.slice(last, match.index)));
      }

      const token = match[0];
      let node;

      if (token.startsWith("**") || token.startsWith("__")) {
        node = document.createElement("strong");
        node.className = "ai-highlight";
        node.textContent = token.slice(2, -2);
      } else if (token.startsWith("`")) {
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

      if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        resetList();
        const table = document.createElement("table");
        table.className = "ai-table";
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        parseTableRow(line).forEach(cellText => {
          const cell = document.createElement("th");
          appendInlineMarkdown(cell, cellText);
          headerRow.appendChild(cell);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        i += 1;
        const tbody = document.createElement("tbody");
        while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1].trim())) {
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

  function syncTopbarRangeButtons() {
    $("topbar-month-btn")?.classList.toggle("active", selectedRange === "1M");
    $("topbar-all-btn")?.classList.toggle("active", selectedRange === "All");
  }
  function getIcon(category) {
    const map = {
      "housing": "🏠", "food": "🍔", "food & drink": "🍔",
      "transport": "🚗", "shopping": "🛍", "entertainment": "🎮",
      "utilities": "⚡", "travel": "✈", "trip": "✈",
      "subscriptions": "📱", "health": "💊", "salary": "💼",
      "freelance": "💻", "investments": "📈", "games": "🎮",
      "emis": "🏦", "projects": "📁", "other": "📦"
    };
    return map[String(category || "").trim().toLowerCase()] || "💳";
  }

  function hashColor(value) {
    const colors = [
      "239,68,68", "245,158,11", "59,130,246",
      "168,85,247", "249,115,22", "6,182,212"
    ];
    let hash = 0;
    for (const char of String(value || "")) {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function getAccountName(id) {
    const account = accountsData.find(item => item.id === id);
    return account ? account.name : "";
  }

  function calcChange(current, previous) {
    const c = Number(current) || 0;
    const p = Number(previous) || 0;
    return p === 0 ? 0 : ((c - p) / Math.abs(p)) * 100;
  }

  function updateBadge(id, value) {
    const element = $(id);
    if (!element) return;

    const numeric = Number(value);
    const rounded = Math.round(Number.isFinite(numeric) ? numeric : 0);

    if (rounded === 0) {
      element.textContent = "";
      element.style.display = "none";
      element.classList.remove("up", "down");
      return;
    }

    element.style.display = "";
    element.classList.remove("up", "down");
    element.textContent = rounded > 0 ? `+${rounded}%` : `${rounded}%`;
    if (rounded > 0) element.classList.add("up");
    if (rounded < 0) element.classList.add("down");
  }

  function buildSpark(monthly, field) {
    return Object.keys(monthly || {})
      .sort()
      .map(month => Number(monthly[month]?.[field] || 0));
  }

  function makeSparkline(id, values, color) {
    const canvas = $(id);
    if (!canvas || typeof Chart === "undefined") return;
    if (sparkCharts[id]) sparkCharts[id].destroy();
    canvas.width = canvas.parentElement?.offsetWidth || 180;
    canvas.height = 40;
    sparkCharts[id] = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: values.map((_, index) => index),
        datasets: [{
          data: values,
          borderColor: color,
          borderWidth: 1.5,
          fill: false,
          tension: 0.35,
          pointRadius: 0
        }]
      },
      options: {
        responsive: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } },
        animation: false
      }
    });
  }

  function renderCashflowChart(monthly) {
    const canvas = $("cashflowChart");
    if (!canvas || typeof Chart === "undefined") return;
    const months = Object.keys(monthly || {}).sort();
    const labels = months.map(month => {
      const [year, monthNumber] = month.split("-");
      return new Date(Number(year), Number(monthNumber) - 1).toLocaleDateString(
        "en-US", { month: "short", year: "2-digit" }
      );
    });
    const income = months.map(month => Number(monthly[month]?.income || 0));
    const expense = months.map(month => Number(monthly[month]?.expense || 0));

    if (cashflowChart) cashflowChart.destroy();
    cashflowChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Income",
            data: income,
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,.08)",
            fill: true,
            tension: .35,
            borderWidth: 2,
            pointRadius: 0
          },
          {
            label: "Expenses",
            data: expense,
            borderColor: "#ef4444",
            backgroundColor: "rgba(239,68,68,.06)",
            fill: true,
            tension: .35,
            borderWidth: 2,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: context => " " + fmt(context.parsed.y) }
          }
        },
        scales: {
          x: { grid: { color: "rgba(255,255,255,.04)" } },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(255,255,255,.04)" },
            ticks: { callback: value => fmt(value) }
          }
        }
      }
    });
  }

  function getFilteredTransactions() {
    const now = new Date();
    if (selectedRange === "All") return txnsData;

    const months = selectedRange === "3M" ? 3 :
      selectedRange === "6M" ? 6 :
      selectedRange === "1Y" ? 12 : 1;

    const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    return txnsData.filter(txn => {
      const date = new Date(txn.date + "T00:00:00");
      return date >= start && date <= now;
    });
  }

  function getCategoryTotals(transactions) {
    const totals = {};
    transactions.forEach(txn => {
      if (txn.type !== "expense") return;
      const category = txn.category || "Other";
      totals[category] = (totals[category] || 0) + Number(txn.amount || 0);
    });
    return totals;
  }

  function renderCatChart(categories) {
    const canvas = $("catChart");
    const entries = Object.entries(categories || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const list = $("cat-list");
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No expense data for this period";
        list.appendChild(empty);
      } else {
        const total = entries.reduce((sum, [, amount]) => sum + Number(amount), 0);
        entries.forEach(([category, amount], index) => {
          const row = document.createElement("div");
          row.className = "cat-row";
          const name = document.createElement("span");
          name.className = "cat-name";
          const dot = document.createElement("span");
          dot.className = "cat-dot";
          dot.style.background = CAT_COLORS[index];
          name.append(dot, document.createTextNode(category));
          const pct = document.createElement("span");
          pct.className = "cat-pct";
          pct.textContent = total ? Math.round(amount / total * 100) + "%" : "0%";
          const value = document.createElement("span");
          value.className = "cat-amount";
          value.textContent = fmt(amount);
          row.append(name, pct, value);
          list.appendChild(row);
        });
      }
    }

    if (!canvas || !entries.length || typeof Chart === "undefined") return;
    if (catChartInst) catChartInst.destroy();
    catChartInst = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: entries.map(([category]) => category),
        datasets: [{
          data: entries.map(([, amount]) => amount),
          backgroundColor: CAT_COLORS.slice(0, entries.length),
          borderWidth: 0,
          hoverOffset: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: { legend: { display: false } }
      }
    });
  }

  function renderInsightsCard() {
    const list = $("insights-list");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    const income = Number(summaryData.income || 0);
    const expense = Number(summaryData.expense || 0);
    const savings = Number(summaryData.savings_rate || 0);
    const categories = summaryData.category_totals || {};
    const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

    const items = [];
    if (top && income > 0) {
      const potential = Math.max(0, Number(top[1]) * .15);
      items.push({
        type: "warn",
        icon: "⚡",
        title: `Potential saving: ${fmt(potential)}`,
        body: `${top[0]} is your largest expense category. Cutting it by 15% would free about ${fmt(potential)}.`
      });
    }
    items.push({
      type: savings >= 20 ? "ok" : "warn",
      icon: savings >= 20 ? "📊" : "⚠️",
      title: savings >= 20 ? "Savings rate is on track" : "Savings rate needs attention",
      body: `${savings.toFixed(1)}% of income is currently retained after expenses.`
    });

    items.forEach(item => {
      const wrap = document.createElement("div");
      wrap.className = "insight-item";
      const header = document.createElement("div");
      header.className = "insight-item-header";
      const icon = document.createElement("div");
      icon.className = `insight-bullet ${item.type}`;
      icon.textContent = item.icon;
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "insight-text-title";
      title.textContent = item.title;
      const description = document.createElement("div");
      description.className = "insight-text-body";
      description.textContent = item.body;
      body.append(title, description);
      header.append(icon, body);
      wrap.appendChild(header);
      list.appendChild(wrap);
    });
  }

  function updateBudgetUI(transactions = getFilteredTransactions()) {
    const categoryTotals = getCategoryTotals(transactions);
    renderBudgetContainer($("budget-items"), categoryTotals, false);
    renderBudgetContainer($("budget-page-list"), categoryTotals, true);
  }

  function renderBudgetContainer(container, categories, detailed) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!budgetsData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No budgets set";
      container.appendChild(empty);
      return;
    }

    budgetsData.forEach(budget => {
      const spent = Number(categories[budget.category] || 0);
      const limit = Number(budget.limit_amt || 0);
      const pct = limit > 0 ? Math.min(100, spent / limit * 100) : 0;
      const over = spent >= limit;

      const item = document.createElement("div");
      item.className = detailed ? "budget-page-item" : "budget-item";

      const header = document.createElement("div");
      header.className = detailed ? "bpi-header" : "budget-item-header";

      const left = document.createElement("div");
      left.className = detailed ? "" : "budget-item-left";
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "10px";

      const icon = document.createElement("div");
      icon.className = "budget-icon";
      icon.textContent = getIcon(budget.category);
      const name = document.createElement("span");
      name.className = detailed ? "bpi-name" : "budget-name";
      name.textContent = budget.category;
      left.append(icon, name);

      if (detailed) {
        const remove = document.createElement("button");
        remove.className = "del-btn";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => deleteBudget(budget.category));
        header.append(left, remove);
      } else {
        const amount = document.createElement("div");
        amount.className = `budget-amounts ${over ? "over" : "ok"}`;
        const main = document.createElement("div");
        main.className = "amount-main";
        main.textContent = `${fmt(spent)} / ${fmt(limit)}`;
        const sub = document.createElement("div");
        sub.className = "amount-sub";
        sub.textContent = over ? `Over by ${fmt(spent - limit)}` : `Remaining ${fmt(limit - spent)}`;
        amount.append(main, sub);
        header.append(left, amount);
      }

      const bar = document.createElement("div");
      bar.className = "budget-bar";
      const fill = document.createElement("div");
      fill.className = `budget-fill ${over ? "red" : pct >= 80 ? "yellow" : "green"}`;
      fill.style.width = pct.toFixed(1) + "%";
      bar.appendChild(fill);

      item.appendChild(header);
      if (detailed) {
        const amounts = document.createElement("div");
        amounts.className = "bpi-amounts";
        amounts.textContent = `Spent: ${fmt(spent)}   •   Limit: ${fmt(limit)}`;
        item.appendChild(amounts);
      }
      item.appendChild(bar);

      if (detailed) {
        const status = document.createElement("div");
        status.style.cssText = "font-size:11px;color:var(--text3);margin-top:6px";
        status.textContent = `${pct.toFixed(0)}% used${over ? " · Over budget!" : pct >= 80 ? " · Near limit" : ""}`;
        item.appendChild(status);
      }
      container.appendChild(item);
    });
  }

  function renderTransactions() {
    const container = $("all-txns");
    if (!container) return;
    const search = ($("search-input")?.value || "").trim().toLowerCase();
    const filtered = search ? txnsData.filter(txn =>
      String(txn.description || "").toLowerCase().includes(search) ||
      String(txn.category || "").toLowerCase().includes(search)
    ) : txnsData;

    while (container.firstChild) container.removeChild(container.firstChild);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No transactions found";
      container.appendChild(empty);
      return;
    }

    filtered.forEach(txn => {
      const row = document.createElement("div");
      row.className = "full-txn-item";

      const icon = document.createElement("div");
      icon.className = "txn-icon";
      icon.style.background = txn.type === "income"
        ? "rgba(34,197,94,.1)"
        : `rgba(${hashColor(txn.category)},.1)`;
      icon.textContent = getIcon(txn.category);

      const info = document.createElement("div");
      info.className = "txn-info";
      const title = document.createElement("div");
      title.className = "txn-name";
      title.textContent = txn.description || txn.category || "Transaction";
      const meta = document.createElement("div");
      meta.className = "txn-meta";
      const account = getAccountName(txn.account_id);
      meta.textContent = `${txn.category || ""}${account ? " · " + account : ""} • ${txn.date || ""}`;
      info.append(title, meta);

      const category = document.createElement("span");
      category.className = "cat-badge";
      category.style.cssText = "background:var(--bg3);color:var(--text2);padding:3px 8px;border-radius:5px;font-size:11px";
      category.textContent = txn.category || "";

      const amount = document.createElement("span");
      amount.className = `txn-amount ${txn.type === "income" ? "inc" : "exp"}`;
      amount.textContent = (txn.type === "income" ? "+" : "-") + fmtDec(txn.amount);

      const edit = document.createElement("button");
      edit.className = "edit-btn";
      edit.textContent = "✏️";
      edit.title = "Edit";
      edit.addEventListener("click", () => openEditModal(txn.id));

      const del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteTxn(txn.id));

      row.append(icon, info, category, amount, edit, del);
      container.appendChild(row);
    });
  }

  function renderRecentTransactions(transactions) {
    const container = $("recent-txns");
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!transactions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No transactions yet";
      container.appendChild(empty);
      return;
    }

    transactions.slice(0, 6).forEach(txn => {
      const row = document.createElement("div");
      row.className = "txn-item";

      const icon = document.createElement("div");
      icon.className = "txn-icon";
      icon.style.background = txn.type === "income"
        ? "rgba(34,197,94,.1)"
        : `rgba(${hashColor(txn.category)},.1)`;
      icon.textContent = getIcon(txn.category);

      const info = document.createElement("div");
      info.className = "txn-info";
      const title = document.createElement("div");
      title.className = "txn-name";
      title.textContent = txn.description || txn.category || "Transaction";
      const meta = document.createElement("div");
      meta.className = "txn-meta";
      const account = getAccountName(txn.account_id);
      meta.textContent = `${txn.category || ""}${account ? " · " + account : ""} • ${txn.date || ""}`;
      info.append(title, meta);

      const amount = document.createElement("span");
      amount.className = `txn-amount ${txn.type === "income" ? "inc" : "exp"}`;
      amount.textContent = (txn.type === "income" ? "+" : "-") + fmtDec(txn.amount);

      row.append(icon, info, amount);
      container.appendChild(row);
    });
  }

  function renderAccounts() {
    const container = $("accounts-list");
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!accountsData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No accounts yet";
      container.appendChild(empty);
      return;
    }

    accountsData.forEach(account => {
      const card = document.createElement("div");
      card.className = "account-card";

      const top = document.createElement("div");
      top.className = "account-top";
      const name = document.createElement("span");
      name.className = "account-name";
      name.textContent = account.name;
      const type = document.createElement("span");
      type.className = "account-badge";
      type.textContent = account.type;
      top.append(name, type);

      const balance = document.createElement("div");
      balance.className = "account-bal";
      balance.textContent = fmtDec(account.current_balance ?? account.balance);

      const actions = document.createElement("div");
      actions.className = "account-actions";

      const edit = document.createElement("button");
      edit.className = "edit-btn";
      edit.textContent = "✏️";
      edit.addEventListener("click", () => editAccount(account.id));

      const del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteAccount(account.id));

      actions.append(edit, del);
      card.append(top, balance, actions);
      container.appendChild(card);
    });
  }

  function populateAccountSelect(id, selectedId = null) {
    const select = $(id);
    if (!select) return;
    while (select.firstChild) select.removeChild(select.firstChild);

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— None —";
    select.appendChild(none);

    accountsData.forEach(account => {
      const option = document.createElement("option");
      option.value = String(account.id);
      option.textContent = `${account.name}${account.type ? " (" + account.type + ")" : ""}`;
      option.selected = selectedId !== null && String(account.id) === String(selectedId);
      select.appendChild(option);
    });
  }

  async function loadTransactions() {
    try {
      txnsData = await apiFetch("/transactions?skip=0&limit=500");
      $("txn-count-badge").textContent = txnsData.length;
      renderRecentTransactions(txnsData);
      renderTransactions();
    } catch (error) {
      showToast("Could not load transactions: " + error.message, "error");
    }
  }

  async function loadBudgets() {
    try {
      budgetsData = await apiFetch("/budgets");
      $("budget-count-badge").textContent = budgetsData.length;
      $("budget-count-header").textContent =
        `${budgetsData.length} active budget${budgetsData.length === 1 ? "" : "s"}`;
      updateBudgetUI();
    } catch (error) {
      showToast("Could not load budgets: " + error.message, "error");
    }
  }

  async function loadAccounts() {
    try {
      accountsData = await apiFetch("/accounts");
      renderAccounts();
    } catch (error) {
      showToast("Could not load accounts: " + error.message, "error");
    }
  }

  async function loadSummary() {
    try {
      const period = selectedRange.toLowerCase();
      const [selected, all] = await Promise.all([
        apiFetch("/summary?period=" + encodeURIComponent(period)),
        apiFetch("/summary?period=all")
      ]);

      summaryData = selected;
      summaryAll = all;

      const totalBalance = Number(all.balance || 0);
      const income = Number(selected.income || 0);
      const expense = Number(selected.expense || 0);
      const savings = Number(selected.savings_rate || 0);
      const balance = Number(selected.balance || 0);

      $("s-bal").textContent = fmtDec(totalBalance);
      $("s-inc").textContent = fmtDec(income);
      $("s-exp").textContent = fmtDec(expense);
      $("s-sav").textContent = savings.toFixed(1) + "%";

      updateBadge("badge-inc", Number(selected.income_change || 0));
      updateBadge("badge-exp", Number(selected.expense_change || 0));
      updateBadge("badge-bal", 0);
      updateBadge("badge-sav", 0);

      $("cf-amount").textContent = fmtDec(balance);
      $("cf-tag").textContent = rangeCashflowLabel(period);
      $("leg-inc").textContent = fmt(income);
      $("leg-exp").textContent = fmt(expense);

      const categoryTotals = selected.category_totals || {};
      $("cat-total").textContent = fmt(expense);
      $("cat-period").textContent = rangeCategoryLabel(period);

      $("hero-sub").textContent = savings >= 20
        ? `Your savings rate is ${savings.toFixed(1)}%. Keep building consistent cash flow.`
        : `Your savings rate is ${savings.toFixed(1)}%. Let's find opportunities to reduce spending.`;

      const monthlyAll = summaryAll.monthly || {};
      const incArr = buildSpark(monthlyAll, "income");
      const expArr = buildSpark(monthlyAll, "expense");
      const balArr = incArr.map((value, index) => value - (expArr[index] || 0));
      const savArr = incArr.map((value, index) =>
        value > 0 ? ((value - (expArr[index] || 0)) / value) * 100 : 0
      );

      makeSparkline("spark-bal", balArr.length ? balArr : [0, totalBalance], "#22c55e");
      makeSparkline("spark-inc", incArr.length ? incArr : [0, income], "#22c55e");
      makeSparkline("spark-exp", expArr.length ? expArr : [0, expense], "#ef4444");
      makeSparkline("spark-sav", savArr.length ? savArr : [0, savings], "#f59e0b");

      renderCatChart(categoryTotals);
      renderBudgetContainer($("budget-items"), categoryTotals, false);
      renderBudgetContainer($("budget-page-list"), categoryTotals, true);
      renderCashflowChart(selected.monthly || {});
      renderInsightsCard();
    } catch (error) {
      console.error("Summary error", error);
      showToast("Could not load dashboard: " + error.message, "error");
    }
  }

  function updateDashboardByRange() {
    const categoryTotals = summaryData.category_totals || {};
    renderCatChart(categoryTotals);
    renderBudgetContainer($("budget-items"), categoryTotals, false);
    renderBudgetContainer($("budget-page-list"), categoryTotals, true);
    $("cat-period").textContent = rangeCategoryLabel(selectedRange.toLowerCase());
    renderCashflowChart(summaryData.monthly || {});
  }

  async function refreshAll() {
    await Promise.all([loadTransactions(), loadBudgets(), loadAccounts()]);
    await loadSummary();
  }

  function refreshCurrentPage() {
    if (currentPage === "transactions") {
      Promise.all([loadTransactions(), loadAccounts(), loadSummary()]);
    } else if (currentPage === "budgets") {
      Promise.all([loadTransactions(), loadBudgets(), loadSummary()]);
    } else if (currentPage === "accounts") {
      Promise.all([loadAccounts(), loadSummary()]);
    } else if (currentPage === "insights") {
      loadInsightsPage();
    } else if (currentPage === "planning") {
      loadPlanningPage();
    } else {
      Promise.all([loadTransactions(), loadBudgets(), loadSummary()]);
    }
  }

  function openModal() {
    $("modal").classList.add("open");
    $("m-date").value = new Date().toISOString().slice(0, 10);
    $("m-amount").value = "";
    $("m-category").value = "";
    $("m-desc").value = "";
    populateAccountSelect("m-account");
  }

  function closeModal() {
    $("modal").classList.remove("open");
  }

  async function submitModal() {
    const amount = Number($("m-amount").value);
    const category = $("m-category").value.trim();
    const date = $("m-date").value;
    const description = $("m-desc").value.trim() || category;
    const accountId = $("m-account").value || null;

    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      showToast("Enter a valid amount, category, and date.", "error");
      return;
    }

    try {
      await apiFetch("/transactions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          type: $("m-type").value,
          amount,
          description,
          category,
          date,
          account_id: accountId
        })
      });
      closeModal();
      await refreshAll();
      showToast("Transaction added.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function openEditModal(id) {
    const txn = txnsData.find(item => item.id === id);
    if (!txn) return;
    editingTxnId = id;
    $("me-type").value = txn.type;
    $("me-amount").value = txn.amount;
    $("me-desc").value = txn.description || "";
    $("me-category").value = txn.category || "";
    $("me-date").value = txn.date || "";
    populateAccountSelect("me-account", txn.account_id);
    $("modal-edit").classList.add("open");
  }

  function closeEditModal() {
    $("modal-edit").classList.remove("open");
    editingTxnId = null;
  }

  async function saveEdit() {
    if (!editingTxnId) return;
    const amount = Number($("me-amount").value);
    const category = $("me-category").value.trim();
    const date = $("me-date").value;
    const description = $("me-desc").value.trim() || category;
    const accountId = $("me-account").value || null;

    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      showToast("Enter valid transaction details.", "error");
      return;
    }

    try {
      await apiFetch("/transactions/" + editingTxnId, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          type: $("me-type").value,
          amount,
          description,
          category,
          date,
          account_id: accountId
        })
      });
      closeEditModal();
      await refreshAll();
      showToast("Transaction updated.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function addTransaction() {
    const amount = Number($("t-amount").value);
    const category = $("t-category").value.trim();
    const date = $("t-date").value;
    const description = $("t-desc").value.trim() || category;
    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      showToast("Enter valid transaction details.", "error");
      return;
    }

    try {
      await apiFetch("/transactions", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          type: $("t-type").value,
          amount,
          description,
          category,
          date
        })
      });
      $("t-amount").value = "";
      $("t-category").value = "";
      $("t-desc").value = "";
      await refreshAll();
      showToast("Transaction added.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteTxn(id) {
    try {
      await apiFetch("/transactions/" + id, {method: "DELETE"});
      await refreshAll();
      showToast("Transaction deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteAllTransactions() {
    try {
      const result = await apiFetch("/transactions/all", {method: "DELETE"});
      await refreshAll();
      showToast(`${result.deleted || 0} transaction(s) deleted.`);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function addBudget() {
    const category = $("b-cat").value.trim();
    const limit = Number($("b-limit").value);
    if (!category || !Number.isFinite(limit) || limit <= 0) {
      showToast("Enter a valid category and monthly limit.", "error");
      return;
    }

    try {
      await apiFetch("/budgets", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({category, limit_amt: limit})
      });
      $("b-cat").value = "";
      $("b-limit").value = "";
      await refreshAll();
      showToast("Budget saved.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteBudget(category) {
    try {
      await apiFetch("/budgets/" + encodeURIComponent(category), {method: "DELETE"});
      await refreshAll();
      showToast("Budget removed.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function openAccountModal(data = null) {
    editingAccountId = data ? data.id : null;
    $("account-modal-title").textContent = data ? "Edit Account" : "Add Account";
    $("ac-name").value = data ? data.name : "";
    $("ac-balance").value = data ? data.balance : "";
    $("ac-type").value = data ? data.type : "checking";
    $("modal-account").classList.add("open");
  }

  function closeAccountModal() {
    $("modal-account").classList.remove("open");
    editingAccountId = null;
  }

  async function saveAccount() {
    const name = $("ac-name").value.trim();
    const balance = Number($("ac-balance").value);
    const type = $("ac-type").value;

    if (!name || !Number.isFinite(balance)) {
      showToast("Enter a valid account name and initial balance.", "error");
      return;
    }

    try {
      await apiFetch(
        editingAccountId ? "/accounts/" + editingAccountId : "/accounts",
        {
          method: editingAccountId ? "PUT" : "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({name, balance, type})
        }
      );
      closeAccountModal();
      await refreshAll();
      showToast(editingAccountId ? "Account updated." : "Account created.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteAccount(id) {
    try {
      await apiFetch("/accounts/" + id, {method: "DELETE"});
      await refreshAll();
      showToast("Account deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function editAccount(id) {
    const account = accountsData.find(item => item.id === id);
    if (account) openAccountModal(account);
  }

  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  function normalizeDate(raw) {
    if (!raw) return new Date().toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (match) {
      let [, month, day, year] = match;
      if (year.length === 2) year = (Number(year) > 50 ? "19" : "20") + year;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
      ? new Date().toISOString().slice(0, 10)
      : parsed.toISOString().slice(0, 10);
  }

  function exportCSV() {
    window.location.href = "/transactions/export.csv";
  }

  async function importCSV(input) {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        showToast("CSV has no data rows.", "error");
        return;
      }

      const headers = parseCSVLine(lines[0]).map(header =>
        header.toLowerCase().replace(/[^a-z0-9_]/g, "")
      );
      const rows = [];

      for (let index = 1; index < lines.length; index += 1) {
        const values = parseCSVLine(lines[index]);
        const row = {};
        headers.forEach((header, position) => {
          row[header] = (values[position] || "").trim();
        });

        const amount = Math.abs(Number(row.amount));
        const category = row.category || row.cat || "";
        if (!Number.isFinite(amount) || amount <= 0 || !category) continue;

        rows.push({
          type: row.type === "income" ? "income" : "expense",
          amount,
          category,
          description: row.description || row.desc || row.note || category,
          date: normalizeDate(row.date),
          account_id: row.account_id ? Number(row.account_id) : null
        });
      }

      input.value = "";
      if (!rows.length) {
        showToast("No valid rows found.", "error");
        return;
      }

      const result = await apiFetch("/transactions/import", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(rows)
      });

      showToast(`Imported ${result.imported || result.created?.length || 0} transaction(s).`);
      await refreshAll();
    } catch (error) {
      input.value = "";
      showToast("Import failed: " + error.message, "error");
    }
  }

  function applyDashboardRange(range) {
    selectedRange = range;
    isAllView = range === "All";
    syncTopbarRangeButtons();
    document.querySelectorAll(".time-btn").forEach(button => {
      button.classList.toggle(
        "active",
        button.textContent.trim().toLowerCase() === range.toLowerCase()
      );
    });
    loadSummary();
  }

  function filterThisMonth() {
    applyDashboardRange("1M");
  }

  function filterAllTime() {
    applyDashboardRange("All");
  }

  function showAllExpenses() {
    applyDashboardRange("All");
  }

  function showMonthlyExpenses() {
    applyDashboardRange("1M");
  }

  function setRange(range, element) {
    selectedRange = range;
    isAllView = range === "All";
    document.querySelectorAll(".time-btn").forEach(button =>
      button.classList.remove("active")
    );
    element?.classList.add("active");
    syncTopbarRangeButtons();
    loadSummary();
  }

  function rangeCashflowLabel(period) {
    const labels = {
      "1m": "Net this month",
      "3m": "Net last 3 months",
      "6m": "Net last 6 months",
      "1y": "Net last 12 months",
      "all": "Net all time"
    };
    return labels[period] || "Net cash flow";
  }

  function rangeCategoryLabel(period) {
    const labels = {
      "1m": new Date().toLocaleDateString("en-US", {month: "long", year: "numeric"}),
      "3m": "Last 3 months",
      "6m": "Last 6 months",
      "1y": "Last 12 months",
      "all": "All time"
    };
    return labels[period] || "Selected period";
  }

  function setGreeting() {
    const hour = new Date().getHours();
    $("greeting").textContent =
      hour < 12 ? "Good morning" :
      hour < 17 ? "Good afternoon" : "Good evening";
  }

  function toggleTheme() {
    const light = document.body.classList.toggle("light");
    localStorage.setItem("theme", light ? "light" : "dark");
  }

  function toggleSidebar() {
    document.body.classList.toggle("sidebar-open");
  }

  function quickAsk(text) {
    $("chat-input").value = text;
    sendChat();
  }

  async function sendChat() {
    const input = $("chat-input");
    const chat = $("chat-msgs");
    const message = input.value.trim();
    if (!message || !chat) return;

    const userWrap = document.createElement("div");
    userWrap.className = "chat-msg user";
    const userBubble = document.createElement("div");
    userBubble.className = "chat-bubble user";
    userBubble.textContent = message;
    userWrap.appendChild(userBubble);
    chat.appendChild(userWrap);

    input.value = "";

    const typing = document.createElement("div");
    typing.className = "chat-msg ai";
    typing.id = "typing";
    const typingBubble = document.createElement("div");
    typingBubble.className = "chat-bubble ai";
    typingBubble.textContent = "I'm analyzing your finances... 📊";
    typing.appendChild(typingBubble);
    chat.appendChild(typing);
    chat.scrollTop = chat.scrollHeight;

    try {
      const result = await apiFetch("/ai/advice", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({question: message, messages: []})
      });

      typing.remove();
      const aiWrap = document.createElement("div");
      aiWrap.className = "chat-msg ai";
      const aiBubble = document.createElement("div");
      aiBubble.className = "chat-bubble ai";
      renderAiMarkdown(aiBubble, result.advice || result.reply || "No response");
      aiWrap.appendChild(aiBubble);
      chat.appendChild(aiWrap);
    } catch (error) {
      typing.remove();
      const errorWrap = document.createElement("div");
      errorWrap.className = "chat-msg ai";
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble ai";
      bubble.textContent = "⚠️ AI is currently unavailable.";
      errorWrap.appendChild(bubble);
      chat.appendChild(errorWrap);
    }

    chat.scrollTop = chat.scrollHeight;
  }

  function createInsightsPage() {
    if ($("page-insights")) return;

    const content = $("content");
    const page = document.createElement("div");
    page.className = "page";
    page.id = "page-insights";

    const hero = document.createElement("div");
    hero.className = "insights-hero";

    const heroText = document.createElement("div");
    const eyebrow = document.createElement("div");
    eyebrow.className = "txn-card-label";
    eyebrow.textContent = "Finance intelligence";
    const title = document.createElement("div");
    title.className = "insights-title";
    title.textContent = "Financial Health & Insights";
    const subtitle = document.createElement("div");
    subtitle.className = "insights-subtitle";
    subtitle.textContent = "Explainable signals calculated from your recorded finances.";
    heroText.append(eyebrow, title, subtitle);

    const refresh = document.createElement("button");
    refresh.className = "insights-refresh";
    refresh.textContent = "↻ Refresh";
    refresh.addEventListener("click", loadInsightsPage);
    hero.append(heroText, refresh);

    const health = document.createElement("div");
    health.className = "health-grid";
    health.id = "health-grid";

    const columns = document.createElement("div");
    columns.className = "insights-columns";

    const recurring = document.createElement("section");
    recurring.className = "insight-panel";
    recurring.innerHTML = '<div class="panel-heading"><span>Recurring expenses</span><span class="panel-count" id="recurring-count">0</span></div><div id="recurring-list"></div>';

    const anomalies = document.createElement("section");
    anomalies.className = "insight-panel";
    anomalies.innerHTML = '<div class="panel-heading"><span>Unusual spending</span><span class="panel-count" id="anomaly-count">0</span></div><div id="anomaly-list"></div>';

    columns.append(recurring, anomalies);

    const note = document.createElement("div");
    note.className = "insight-note";
    note.textContent = "These are analytical signals, not investment or financial advice.";

    page.append(hero, health, columns, note);
    content.appendChild(page);
  }

  function activateInsights() {
    currentPage = "insights";
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    $("page-insights").classList.add("active");
    $("insights-nav-item").classList.add("active");
    $("topbar-title").textContent = "Financial Insights";
    $("content").style.overflow = "";
    $("content").style.padding = "";
    loadInsightsPage();
  }

  async function loadInsightsPage() {
    createInsightsPage();
    try {
      const payload = await apiFetch("/api/insights/dashboard");
      renderHealth(payload.health);
      renderRecurring(payload.recurring || [], payload.counts?.recurring || 0);
      renderAnomalies(payload.anomalies || [], payload.counts?.anomalies || 0);
    } catch (error) {
      const grid = $("health-grid");
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      const err = document.createElement("div");
      err.className = "insight-error";
      err.textContent = "Could not load insights: " + error.message;
      grid.appendChild(err);
    }
  }

  function renderHealth(health) {
    const grid = $("health-grid");
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);

    const scoreCard = document.createElement("div");
    scoreCard.className = "health-score-card";
    const score = document.createElement("div");
    score.className = "health-score";
    score.textContent = Number(health.score || 0);
    const grade = document.createElement("div");
    grade.className = "health-grade";
    grade.textContent = health.grade || "Needs attention";
    const metrics = document.createElement("div");
    metrics.className = "health-metrics";
    metrics.textContent =
      `Savings ${Number(health.metrics?.savings_rate || 0).toFixed(1)}% · Cash buffer ${Number(health.metrics?.months_of_buffer || 0).toFixed(1)} months`;
    scoreCard.append(score, grade, metrics);

    const details = document.createElement("div");
    details.className = "health-details";
    const heading = document.createElement("div");
    heading.className = "panel-heading";
    heading.textContent = "Score breakdown";
    details.appendChild(heading);

    Object.entries(health.components || {}).forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "score-row";
      const name = document.createElement("span");
      name.textContent = key.replaceAll("_", " ");
      const val = document.createElement("strong");
      val.textContent = Number(value).toFixed(1);
      row.append(name, val);
      details.appendChild(row);
    });

    grid.append(scoreCard, details);
  }

  function renderRecurring(items, count) {
    const list = $("recurring-list");
    const badge = $("recurring-count");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (badge) badge.textContent = count;

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "insight-empty";
      empty.textContent = "No recurring monthly expenses detected yet.";
      list.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "signal-row";
      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.description || item.category;
      const meta = document.createElement("div");
      meta.className = "signal-meta";
      meta.textContent =
        `${item.occurrences} occurrences · every ~${item.median_interval_days} days · last ${item.last_date}`;
      left.append(title, meta);
      const amount = document.createElement("strong");
      amount.textContent = fmt(item.estimated_monthly_cost);
      row.append(left, amount);
      list.appendChild(row);
    });
  }

  function renderAnomalies(items, count) {
    const list = $("anomaly-list");
    const badge = $("anomaly-count");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (badge) badge.textContent = count;

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "insight-empty";
      empty.textContent = "No unusually large expenses detected.";
      list.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "signal-row";
      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.description || item.category;
      const meta = document.createElement("div");
      meta.className = "signal-meta";
      meta.textContent =
        `${item.category} · ${item.date} · ${item.multiple_of_average}× category average`;
      left.append(title, meta);
      const amount = document.createElement("strong");
      amount.textContent = fmt(item.amount);
      if (item.severity === "high") amount.className = "signal-danger";
      row.append(left, amount);
      list.appendChild(row);
    });
  }

  let goalsData = [];
  let netWorthData = {};
  let netWorthHistory = [];
  let monthlyReportData = {};
  let netWorthChart = null;

  function createPlanningPage() {
    if ($("page-planning")) return;
    const page = document.createElement("div");
    page.className = "page";
    page.id = "page-planning";

    const hero = document.createElement("div");
    hero.className = "planning-hero";
    const heroText = document.createElement("div");
    const eyebrow = document.createElement("div");
    eyebrow.className = "txn-card-label";
    eyebrow.textContent = "Planning & wealth";
    const title = document.createElement("div");
    title.className = "planning-title";
    title.textContent = "Goals, Net Worth & Monthly Report";
    const subtitle = document.createElement("div");
    subtitle.className = "planning-subtitle";
    subtitle.textContent = "Track what you are building, what you own, and how the month went.";
    heroText.append(eyebrow, title, subtitle);
    const refresh = document.createElement("button");
    refresh.className = "planning-refresh";
    refresh.textContent = "↻ Refresh";
    refresh.addEventListener("click", loadPlanningPage);
    hero.append(heroText, refresh);

    const wealth = document.createElement("section");
    wealth.className = "wealth-card";
    wealth.id = "net-worth-card";

    const goalsPanel = document.createElement("section");
    goalsPanel.className = "planning-panel";
    const goalsHeader = document.createElement("div");
    goalsHeader.className = "planning-panel-header";
    const goalsTitle = document.createElement("div");
    goalsTitle.className = "planning-panel-title";
    goalsTitle.textContent = "Financial goals";
    goalsHeader.appendChild(goalsTitle);
    const form = document.createElement("div");
    form.className = "goal-form";
    [["goal-name","text","Goal name"],["goal-target","number","Target ₹"],["goal-current","number","Current ₹"],["goal-date","date","Target date"],["goal-category","text","Category"]].forEach(([id,type,placeholder]) => {
      const input = document.createElement("input");
      input.id = id; input.type = type; input.placeholder = placeholder;
      if (id === "goal-category") input.value = "Savings";
      if (type === "number") { input.min = id === "goal-target" ? "0.01" : "0"; input.step = "0.01"; }
      form.appendChild(input);
    });
    const addButton = document.createElement("button");
    addButton.className = "btn-add";
    addButton.textContent = "Add goal";
    addButton.addEventListener("click", createGoal);
    form.appendChild(addButton);
    const goalsList = document.createElement("div");
    goalsList.id = "goals-list";
    goalsPanel.append(goalsHeader, form, goalsList);

    const reportPanel = document.createElement("section");
    reportPanel.className = "planning-panel";
    const reportHeader = document.createElement("div");
    reportHeader.className = "planning-panel-header";
    const reportTitle = document.createElement("div");
    reportTitle.className = "planning-panel-title";
    reportTitle.textContent = "Monthly report";
    const month = document.createElement("input");
    month.id = "report-month"; month.type = "month";
    month.addEventListener("change", loadMonthlyReport);
    reportHeader.append(reportTitle, month);
    const report = document.createElement("div"); report.id = "monthly-report";
    reportPanel.append(reportHeader, report);

    const columns = document.createElement("div");
    columns.className = "planning-columns";
    columns.append(goalsPanel, reportPanel);
    page.append(hero, wealth, columns);
    $("content").appendChild(page);
  }

  function activatePlanning() {
    currentPage = "planning";
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    $("page-planning").classList.add("active");
    $("planning-nav-item").classList.add("active");
    $("topbar-title").textContent = "Planning & Wealth";
    $("content").style.overflow = "";
    $("content").style.padding = "";
    loadPlanningPage();
  }

  async function loadPlanningPage() {
    createPlanningPage();
    if (!$("report-month").value) $("report-month").value = new Date().toISOString().slice(0, 7);
    try {
      const [goals, netWorth, history] = await Promise.all([
        apiFetch("/goals"),
        apiFetch("/api/net-worth"),
        apiFetch("/api/net-worth/history?months=12")
      ]);
      goalsData = goals;
      netWorthData = netWorth;
      netWorthHistory = history.history || [];
      renderGoals();
      renderNetWorth();
      await loadMonthlyReport();
    } catch (error) { showToast("Could not load planning data: " + error.message, "error"); }
  }

  function renderNetWorth() {
    const card = $("net-worth-card"); if (!card) return;
    while (card.firstChild) card.removeChild(card.firstChild);
    const header = document.createElement("div"); header.className = "wealth-header";
    const title = document.createElement("div"); title.className = "planning-panel-title"; title.textContent = "Current net worth";
    const note = document.createElement("span"); note.className = "wealth-note"; note.textContent = "Derived from account balances";
    header.append(title, note);
    const summary = document.createElement("div"); summary.className = "wealth-summary";
    [["Net worth",netWorthData.net_worth,"net"],["Assets",netWorthData.asset_total,"asset"],["Liabilities",netWorthData.liability_total,"liability"]].forEach(([label,value,type]) => {
      const metric = document.createElement("div"); metric.className = "wealth-metric";
      const l = document.createElement("div"); l.className = "wealth-metric-label"; l.textContent = label;
      const v = document.createElement("div"); v.className = "wealth-metric-value " + type; v.textContent = fmtDec(value);
      metric.append(l,v); summary.appendChild(metric);
    });
    const trendWrap = document.createElement("div");
    trendWrap.className = "wealth-trend-wrap";
    const trendTitle = document.createElement("div");
    trendTitle.className = "report-list-title";
    trendTitle.textContent = "Net worth trend";
    const canvas = document.createElement("canvas");
    canvas.id = "net-worth-chart";
    canvas.height = 90;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Net worth trend for the last twelve months");
    trendWrap.append(trendTitle, canvas);

    const breakdown = document.createElement("div"); breakdown.className = "wealth-breakdown";
    [...(netWorthData.assets || []), ...(netWorthData.liabilities || [])].forEach(item => {
      const row=document.createElement("div"); row.className="wealth-row";
      const name=document.createElement("span"); name.textContent=item.name;
      const kind=document.createElement("span"); kind.className="wealth-type"; kind.textContent=item.type;
      const amount=document.createElement("strong"); amount.textContent=fmtDec(item.type === "credit" ? -item.balance : item.balance);
      row.append(name,kind,amount); breakdown.appendChild(row);
    });
    if (netWorthChart) netWorthChart.destroy();
    const chart = $("net-worth-chart");
    if (chart && typeof Chart !== "undefined" && netWorthHistory.length) {
      netWorthChart = new Chart(chart.getContext("2d"), {
        type: "line",
        data: {
          labels: netWorthHistory.map(item => item.month),
          datasets: [{
            data: netWorthHistory.map(item => item.net_worth),
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,.08)",
            borderWidth: 2,
            fill: true,
            tension: .35,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: { display: false }
          }
        }
      });
    }

    card.append(header,summary,trendWrap,breakdown);
  }

  function renderGoals() {
    const list=$("goals-list"); if(!list) return;
    while(list.firstChild) list.removeChild(list.firstChild);
    if(!goalsData.length){ const empty=document.createElement("div"); empty.className="planning-empty"; empty.textContent="No financial goals yet. Add your first target above."; list.appendChild(empty); return; }
    goalsData.forEach(goal => {
      const item=document.createElement("div"); item.className="goal-item";
      const top=document.createElement("div"); top.className="goal-top";
      const info=document.createElement("div");
      const name=document.createElement("strong"); name.textContent=goal.name;
      const meta=document.createElement("div"); meta.className="goal-meta"; meta.textContent=goal.category+" · "+(goal.target_date ? "Target "+goal.target_date : "No target date");
      info.append(name,meta);
      const status=document.createElement("span"); status.className="goal-status "+goal.status; status.textContent=goal.status;
      top.append(info,status);
      const pr=document.createElement("div"); pr.className="goal-progress-row";
      const amount=document.createElement("span"); amount.textContent=fmtDec(goal.current_amount)+" / "+fmtDec(goal.target_amount);
      const pct=document.createElement("strong"); pct.textContent=Number(goal.progress_percent).toFixed(0)+"%"; pr.append(amount,pct);
      const bar=document.createElement("div"); bar.className="goal-bar"; const fill=document.createElement("div"); fill.className="goal-fill"; fill.style.width=Math.min(100,Number(goal.progress_percent)||0).toFixed(1)+"%"; bar.appendChild(fill);
      const footer=document.createElement("div"); footer.className="goal-footer";
      const plan=document.createElement("span"); plan.textContent=goal.monthly_required ? fmtDec(goal.monthly_required)+"/month needed" : (goal.status==="completed" ? "Goal completed" : "Set a target date for a monthly plan");
      const actions=document.createElement("div");
      const update=document.createElement("button"); update.className="goal-action"; update.textContent="Update"; update.addEventListener("click",()=>updateGoalPrompt(goal));
      const remove=document.createElement("button"); remove.className="goal-action danger"; remove.textContent="Delete"; remove.addEventListener("click",()=>deleteGoal(goal.id));
      actions.append(update,remove); footer.append(plan,actions);
      item.append(top,pr,bar,footer); list.appendChild(item);
    });
  }

  async function createGoal(){
    const name=$("goal-name").value.trim(); const target=Number($("goal-target").value); const current=Number($("goal-current").value||0);
    const targetDate=$("goal-date").value||null; const category=$("goal-category").value.trim()||"Savings";
    if(!name||!Number.isFinite(target)||target<=0||!Number.isFinite(current)||current<0||current>target){showToast("Enter a valid goal and keep current amount at or below target.","error");return;}
    try{
      await apiFetch("/goals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,target_amount:target,current_amount:current,target_date:targetDate,category})});
      ["goal-name","goal-target","goal-current","goal-date"].forEach(id=>$(id).value=""); $("goal-category").value="Savings";
      await loadPlanningPage(); showToast("Goal created.");
    }catch(error){showToast(error.message,"error");}
  }

  async function updateGoalPrompt(goal){
    const raw=prompt("Update saved amount for "+goal.name+" (current: "+goal.current_amount+").",String(goal.current_amount));
    if(raw===null)return; const current=Number(raw);
    if(!Number.isFinite(current)||current<0||current>goal.target_amount){showToast("Enter a valid saved amount.","error");return;}
    try{await apiFetch("/goals/"+goal.id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({current_amount:current})}); await loadPlanningPage(); showToast("Goal updated.");}catch(error){showToast(error.message,"error");}
  }

  async function deleteGoal(id){
    try{await apiFetch("/goals/"+id,{method:"DELETE"}); await loadPlanningPage(); showToast("Goal deleted.");}catch(error){showToast(error.message,"error");}
  }

  async function loadMonthlyReport(){
    const month=$("report-month")?.value; if(!month)return;
    try{monthlyReportData=await apiFetch("/api/reports/monthly?month="+encodeURIComponent(month)); renderMonthlyReport();}catch(error){showToast("Could not load monthly report: "+error.message,"error");}
  }

  function renderMonthlyReport(){
    const container=$("monthly-report"); if(!container)return; while(container.firstChild)container.removeChild(container.firstChild);
    const metrics=document.createElement("div"); metrics.className="report-metrics";
    [["Income",monthlyReportData.income],["Expenses",monthlyReportData.expense],["Net cash flow",monthlyReportData.net_cash_flow],["Savings rate",Number(monthlyReportData.savings_rate||0).toFixed(1)+"%"]].forEach(([label,value])=>{
      const metric=document.createElement("div"); metric.className="report-metric";
      const l=document.createElement("div"); l.className="report-label"; l.textContent=label;
      const v=document.createElement("div"); v.className="report-value"; v.textContent=typeof value==="number"?fmtDec(value):String(value); metric.append(l,v); metrics.appendChild(metric);
    });
    const compare=document.createElement("div"); compare.className="report-compare";
    compare.textContent="Previous month: "+fmt(monthlyReportData.previous_month?.income||0)+" income · "+fmt(monthlyReportData.previous_month?.expense||0)+" expenses · "+fmt(monthlyReportData.previous_month?.net_cash_flow||0)+" net";
    const list=document.createElement("div"); list.className="report-list"; const title=document.createElement("div"); title.className="report-list-title"; title.textContent="Top spending categories"; list.appendChild(title);
    (monthlyReportData.top_categories||[]).forEach(item=>{const row=document.createElement("div");row.className="report-row";const l=document.createElement("span");l.textContent=item.category;const v=document.createElement("strong");v.textContent=fmt(item.amount);row.append(l,v);list.appendChild(row);});
    const recurring=document.createElement("div"); recurring.className="report-recurring"; recurring.textContent=(monthlyReportData.recurring_expenses||[]).length ? "Recurring signals detected: "+monthlyReportData.recurring_expenses.length : "No recurring expense signals detected.";
    container.append(metrics,compare,list,recurring);
  }
  function goPage(name, element) {
    if (name === "insights") {
      activateInsights();
      return;
    }
    if (name === "planning") {
      activatePlanning();
      return;
    }

    currentPage = name;
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));

    const page = $("page-" + name);
    if (page) page.classList.add("active");
    if (element) element.classList.add("active");

    const titles = {
      dashboard: "Overview",
      transactions: "Transactions",
      budgets: "Budgets",
      accounts: "Accounts",
      planning: "Planning & Wealth",
      "ai-page": "AI Assistant"
    };
    $("topbar-title").textContent = titles[name] || name;

    const content = $("content");
    if (name === "ai-page") {
      content.style.overflow = "hidden";
      content.style.padding = "0";
    } else {
      content.style.overflow = "";
      content.style.padding = "";
    }

    refreshCurrentPage();
  }

  function init() {
    setGreeting();
    syncTopbarRangeButtons();
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") document.body.classList.add("light");

    createInsightsPage();
    createPlanningPage();

    const navHost = document.querySelector(".sidebar > div:nth-of-type(2)");
    if (navHost && !$("planning-nav-item")) {
      const item = document.createElement("div");
      item.className = "nav-item";
      item.id = "planning-nav-item";
      const icon = document.createElement("span");
      icon.className = "nav-icon";
      icon.textContent = "◎";
      item.append(icon, document.createTextNode(" Planning & Wealth"));
      item.addEventListener("click", activatePlanning);
      navHost.appendChild(item);
    }

    if (navHost && !$("insights-nav-item")) {
      const item = document.createElement("div");
      item.className = "nav-item";
      item.id = "insights-nav-item";
      const icon = document.createElement("span");
      icon.className = "nav-icon";
      icon.textContent = "◈";
      item.append(icon, document.createTextNode(" Financial Insights"));
      item.addEventListener("click", activateInsights);
      navHost.appendChild(item);
    }

    $("modal")?.addEventListener("click", event => {
      if (event.target === $("modal")) closeModal();
    });
    $("modal-edit")?.addEventListener("click", event => {
      if (event.target === $("modal-edit")) closeEditModal();
    });
    $("modal-account")?.addEventListener("click", event => {
      if (event.target === $("modal-account")) closeAccountModal();
    });
    $("search-input")?.addEventListener("input", renderTransactions);
    $("view-all-expenses")?.addEventListener("click", () => {
      if (selectedRange === "1M") showAllExpenses();
      else showMonthlyExpenses();
    });

    $("t-date").value = new Date().toISOString().slice(0, 10);
    $("m-date").value = new Date().toISOString().slice(0, 10);
    $("search-input")?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.target.value = "";
        renderTransactions();
      }
    });

    refreshAll();
  }

  // Preserve the existing inline onclick API.
  Object.assign(window, {
    goPage,
    toggleTheme,
    toggleSidebar,
    openModal,
    closeModal,
    submitModal,
    openEditModal,
    closeEditModal,
    saveEdit,
    addTransaction,
    deleteTxn,
    deleteAllTransactions,
    addBudget,
    deleteBudget,
    openAccountModal,
    closeAccountModal,
    saveAccount,
    deleteAccount,
    editAccount,
    importCSV,
    exportCSV,
    filterThisMonth,
    setRange,
    filterAllTime,
    quickAsk,
    sendChat,
    showAllExpenses,
    showMonthlyExpenses,
    refreshCurrentPage
  });

  window.addEventListener("DOMContentLoaded", init);
})();