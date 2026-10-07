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
    const source = String(text ?? "");
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match.index > last) parent.appendChild(document.createTextNode(source.slice(last, match.index)));
      const token = match[0];
      const node = token.startsWith("**")
        ? document.createElement("strong")
        : token.startsWith("`")
          ? document.createElement("code")
          : document.createElement("em");
      node.className = token.startsWith("**") ? "ai-highlight" : "";
      node.textContent = token.startsWith("**") || token.startsWith("`")
        ? token.slice(2, -2)
        : token.slice(1, -1);
      parent.appendChild(node);
      last = pattern.lastIndex;
    }
    if (last < source.length) parent.appendChild(document.createTextNode(source.slice(last)));
  }

  function parseTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  }

  function renderAiMarkdown(container, markdown) {
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
    const rounded = Math.round(Number(value) || 0);
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
    const categories = getCategoryTotals(getFilteredTransactions());
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
      const [current, all, accounts] = await Promise.all([
        apiFetch("/summary?period=1m"),
        apiFetch("/summary?period=all"),
        apiFetch("/accounts")
      ]);
      summaryData = current;
      summaryAll = all;
      accountsData = accounts;
      renderAccounts();

      const totalBalance = accounts.reduce(
        (sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0
      );

      const income = Number(current.income || 0);
      const expense = Number(current.expense || 0);
      const savings = Number(current.savings_rate || 0);

      const previousIncome = Number(current.income_change || 0) === 0 ? 0 :
        income / (1 + Number(current.income_change || 0) / 100);
      const previousExpense = Number(current.expense_change || 0) === 0 ? 0 :
        expense / (1 + Number(current.expense_change || 0) / 100);

      $("s-bal").textContent = fmtDec(totalBalance);
      $("s-inc").textContent = fmtDec(income);
      $("s-exp").textContent = fmtDec(expense);
      $("s-sav").textContent = savings.toFixed(1) + "%";

      updateBadge("badge-inc", calcChange(income, previousIncome));
      updateBadge("badge-exp", calcChange(expense, previousExpense));
      updateBadge("badge-bal", totalBalance ? Number(current.balance_change || 0) : 0);
      updateBadge("badge-sav", 0);

      $("cf-amount").textContent = fmtDec(current.balance);
      $("leg-inc").textContent = fmt(income);
      $("leg-exp").textContent = fmt(expense);
      $("cat-total").textContent = fmt(expense);

      const now = new Date();
      $("cat-period").textContent = now.toLocaleDateString("en-US", {
        month: "long", year: "numeric"
      });

      $("hero-sub").textContent = savings >= 20
        ? `Your savings rate is ${savings.toFixed(1)}%. Keep building consistent cash flow.`
        : `Your savings rate is ${savings.toFixed(1)}%. Let's find opportunities to reduce spending.`;

      const monthly = summaryAll.monthly || {};
      const incArr = buildSpark(monthly, "income");
      const expArr = buildSpark(monthly, "expense");
      const balArr = incArr.map((value, index) => value - (expArr[index] || 0));
      const savArr = incArr.map((value, index) =>
        value > 0 ? ((value - (expArr[index] || 0)) / value) * 100 : 0
      );

      makeSparkline("spark-bal", balArr.length ? balArr : [0, totalBalance], "#22c55e");
      makeSparkline("spark-inc", incArr.length ? incArr : [0, income], "#22c55e");
      makeSparkline("spark-exp", expArr.length ? expArr : [0, expense], "#ef4444");
      makeSparkline("spark-sav", savArr.length ? savArr : [0, savings], "#f59e0b");

      updateDashboardByRange();
      renderInsightsCard();
    } catch (error) {
      console.error("Summary error", error);
      showToast("Could not load dashboard: " + error.message, "error");
    }
  }

  function updateDashboardByRange() {
    const filtered = getFilteredTransactions();
    renderCatChart(getCategoryTotals(filtered));
    updateBudgetUI(filtered);

    if (selectedRange === "All") {
      $("cat-period").textContent = "All time";
    } else {
      $("cat-period").textContent = new Date().toLocaleDateString("en-US", {
        month: "long", year: "numeric"
      });
    }

    const allMonthly = summaryAll.monthly || {};
    const entries = Object.entries(allMonthly).sort(([a], [b]) => a.localeCompare(b));
    const count = selectedRange === "3M" ? 3 :
      selectedRange === "6M" ? 6 :
      selectedRange === "1Y" ? 12 :
      selectedRange === "1M" ? 1 : entries.length;
    const monthly = Object.fromEntries(entries.slice(-count));
    renderCashflowChart(monthly);
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