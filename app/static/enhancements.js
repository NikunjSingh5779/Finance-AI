(() => {
  "use strict";

  const esc = value => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  function textNode(value) {
    return document.createTextNode(String(value ?? ""));
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function renderTransactionNodes(container, data) {
    clear(container);
    if (!data.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No transactions found";
      container.appendChild(empty);
      return;
    }

    data.forEach(t => {
      const inc = t.type === "income";
      const row = document.createElement("div");
      row.className = "full-txn-item";

      const icon = document.createElement("div");
      icon.className = "txn-icon";
      icon.style.background = inc ? "rgba(34,197,94,0.1)" : `rgba(${hashColor(t.category)},0.1)`;
      icon.textContent = getIcon(t.category);

      const info = document.createElement("div");
      info.className = "txn-info";
      const name = document.createElement("div");
      name.className = "txn-name";
      name.textContent = t.description || t.desc || t.category || "Transaction";
      const meta = document.createElement("div");
      meta.className = "txn-meta";
      const account = getAccountName(t.account_id);
      meta.textContent = `${t.category || ""}${account ? " · " + account : ""} • ${t.date || ""}`;
      info.append(name, meta);

      const cat = document.createElement("span");
      cat.className = "cat-badge";
      cat.style.cssText = "background:var(--bg3);color:var(--text2);padding:3px 8px;border-radius:5px;font-size:11px";
      cat.textContent = t.category || "";

      const amount = document.createElement("span");
      amount.className = `txn-amount ${inc ? "inc" : "exp"}`;
      amount.textContent = (inc ? "+" : "-") + fmtDec(t.amount);

      const edit = document.createElement("button");
      edit.className = "edit-btn";
      edit.title = "Edit";
      edit.textContent = "✏️";
      edit.addEventListener("click", () => openEditModal(t.id));

      const del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteTxn(t.id));

      row.append(icon, info, cat, amount, edit, del);
      container.appendChild(row);
    });
  }

  window.renderRecentTxns = function(txns) {
    const el = document.getElementById("recent-txns");
    if (!el) return;
    clear(el);
    if (!txns.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No transactions yet";
      el.appendChild(empty);
      return;
    }
    txns.forEach(t => {
      const row = document.createElement("div");
      row.className = "txn-item";
      const inc = t.type === "income";
      const icon = document.createElement("div");
      icon.className = "txn-icon";
      icon.style.background = inc ? "rgba(34,197,94,0.1)" : `rgba(${hashColor(t.category)},0.1)`;
      icon.textContent = getIcon(t.category);

      const info = document.createElement("div");
      info.className = "txn-info";
      const name = document.createElement("div");
      name.className = "txn-name";
      name.textContent = t.description || t.desc || t.category || "Transaction";
      const meta = document.createElement("div");
      meta.className = "txn-meta";
      const account = getAccountName(t.account_id);
      meta.textContent = `${t.category || ""}${account ? " · " + account : ""} • ${t.date || ""}`;
      info.append(name, meta);

      const amount = document.createElement("span");
      amount.className = `txn-amount ${inc ? "inc" : "exp"}`;
      amount.textContent = (inc ? "+" : "-") + fmtDec(t.amount);
      row.append(icon, info, amount);
      el.appendChild(row);
    });
  };

  window.renderAllTxns = function(data = txnsData) {
    const input = document.getElementById("search-input");
    const search = (input?.value || "").trim().toLowerCase();
    const filtered = search ? data.filter(t =>
      String(t.description || t.desc || "").toLowerCase().includes(search) ||
      String(t.category || "").toLowerCase().includes(search)
    ) : data;
    const el = document.getElementById("all-txns");
    if (el) renderTransactionNodes(el, filtered);
  };

  window.renderAccounts = function() {
    const el = document.getElementById("accounts-list");
    if (!el) return;
    clear(el);
    if (!accountsData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No accounts yet";
      el.appendChild(empty);
      return;
    }

    accountsData.forEach(a => {
      const card = document.createElement("div");
      card.className = "account-card";

      const top = document.createElement("div");
      top.className = "account-top";
      const name = document.createElement("span");
      name.className = "account-name";
      name.textContent = a.name;
      const badge = document.createElement("span");
      badge.className = "account-badge";
      badge.textContent = a.type;
      top.append(name, badge);

      const bal = document.createElement("div");
      bal.className = "account-bal";
      bal.textContent = fmtDec(a.current_balance ?? a.balance);

      const actions = document.createElement("div");
      actions.className = "account-actions";
      const edit = document.createElement("button");
      edit.className = "edit-btn";
      edit.textContent = "✏️";
      edit.title = "Edit";
      edit.addEventListener("click", () => editAccount(a.id));
      const del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteAccount(a.id));
      actions.append(edit, del);

      card.append(top, bal, actions);
      el.appendChild(card);
    });
  };

  window.populateAccountSelect = function(selectId, selectedId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    clear(sel);
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— None —";
    sel.appendChild(none);

    accountsData.forEach(a => {
      const option = document.createElement("option");
      option.value = String(a.id);
      option.textContent = `${a.name}${a.type ? " (" + a.type + ")" : ""}`;
      if (selectedId && a.id === selectedId) option.selected = true;
      sel.appendChild(option);
    });
  };

  window.renderCatChart = function(cats) {
    const entries = Object.entries(cats || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const total = entries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
    const list = document.getElementById("cat-list");
    if (list) {
      clear(list);
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No expense data for this period";
        list.appendChild(empty);
      } else {
        entries.forEach(([category, amount], index) => {
          const row = document.createElement("div");
          row.className = "cat-row";

          const name = document.createElement("span");
          name.className = "cat-name";
          const dot = document.createElement("span");
          dot.className = "cat-dot";
          dot.style.background = CAT_COLORS[index];
          name.append(dot, textNode(category));

          const pct = document.createElement("span");
          pct.className = "cat-pct";
          pct.textContent = total > 0 ? Math.round(Number(amount) / total * 100) + "%" : "0%";

          const val = document.createElement("span");
          val.className = "cat-amount";
          val.textContent = fmt(amount);

          row.append(name, pct, val);
          list.appendChild(row);
        });
      }
    }

    const canvas = document.getElementById("catChart");
    if (!canvas || !entries.length) return;
    const ctx = canvas.getContext("2d");
    if (catChartInst) catChartInst.destroy();
    catChartInst = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: entries.map(([name]) => name),
        datasets: [{
          data: entries.map(([, value]) => value),
          backgroundColor: CAT_COLORS.slice(0, entries.length),
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => " " + fmt(c.parsed) } }
        }
      }
    });
  };

  window.renderInsights = function(income, expense, savingsRate, cats) {
    const list = document.getElementById("insights-list");
    if (!list) return;
    clear(list);
    const top = Object.entries(cats || {}).sort((a, b) => b[1] - a[1])[0];
    const items = [];

    if (top && income > 0) {
      const saved = Math.max(0, Number(top[1]) * 0.15);
      items.push({
        type: "warn",
        icon: "⚡",
        title: `Potential saving: ${fmt(saved)}`,
        body: `${top[0]} is your largest expense category. A 15% reduction would free about ${fmt(saved)}.`
      });
    }

    items.push({
      type: savingsRate >= 20 ? "ok" : "warn",
      icon: savingsRate >= 20 ? "📊" : "⚠️",
      title: savingsRate >= 20 ? "Savings rate is on track" : "Savings rate needs attention",
      body: `${Number(savingsRate).toFixed(1)}% of income is currently retained after expenses.`
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
      const text = document.createElement("div");
      text.className = "insight-text-body";
      text.textContent = item.body;
      body.append(title, text);
      header.append(icon, body);
      wrap.appendChild(header);
      list.appendChild(wrap);
    });
  };

  function safeBudgetMarkup(filteredTxns, targetId) {
    const cats = getCategoryTotals(filteredTxns);
    const el = document.getElementById(targetId);
    if (!el) return;
    clear(el);

    if (!budgetsData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No budgets set";
      el.appendChild(empty);
      return;
    }

    budgetsData.forEach(b => {
      const spent = Number(cats[b.category] || 0);
      const limit = Number(b.limit_amt || 0);
      const pct = limit > 0 ? Math.min(100, spent / limit * 100) : 0;
      const over = spent >= limit;
      const item = document.createElement("div");
      item.className = targetId === "budget-page-list" ? "budget-page-item" : "budget-item";

      const title = document.createElement("div");
      title.className = targetId === "budget-page-list" ? "bpi-header" : "budget-item-header";
      const left = document.createElement("div");
      left.className = targetId === "budget-page-list" ? "" : "budget-item-left";
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "10px";

      const icon = document.createElement("div");
      icon.className = "budget-icon";
      icon.textContent = getIcon(b.category);
      const name = document.createElement("span");
      name.className = targetId === "budget-page-list" ? "bpi-name" : "budget-name";
      name.textContent = b.category;
      left.append(icon, name);

      const amounts = document.createElement("div");
      amounts.className = `budget-amounts ${over ? "over" : "ok"}`;
      const main = document.createElement("div");
      main.className = "amount-main";
      main.textContent = `${fmt(spent)} / ${fmt(limit)}`;
      const sub = document.createElement("div");
      sub.className = "amount-sub";
      sub.textContent = over ? `Over by ${fmt(spent - limit)}` : `Remaining ${fmt(limit - spent)}`;
      amounts.append(main, sub);

      const actions = document.createElement("div");
      if (targetId === "budget-page-list") {
        const del = document.createElement("button");
        del.className = "del-btn";
        del.textContent = "Remove";
        del.addEventListener("click", () => deleteBudget(b.category));
        actions.appendChild(del);
        title.append(left, actions);
        item.appendChild(title);
        const line = document.createElement("div");
        line.className = "bpi-amounts";
        line.textContent = `Spent: ${fmt(spent)}   •   Limit: ${fmt(limit)}`;
        item.appendChild(line);
      } else {
        title.append(left, amounts);
        item.appendChild(title);
      }

      const bar = document.createElement("div");
      bar.className = "budget-bar";
      const fill = document.createElement("div");
      fill.className = `budget-fill ${over ? "red" : pct >= 80 ? "yellow" : "green"}`;
      fill.style.width = pct.toFixed(1) + "%";
      bar.appendChild(fill);
      item.appendChild(bar);

      if (targetId === "budget-page-list") {
        const status = document.createElement("div");
        status.style.cssText = "font-size:11px;color:var(--text3);margin-top:6px";
        status.textContent = `${pct.toFixed(0)}% used${over ? " · Over budget!" : pct >= 80 ? " · Near limit" : ""}`;
        item.appendChild(status);
      }

      el.appendChild(item);
    });
  }

  window.renderBudgets = function() {
    const currentMonth = new Date();
    const filtered = txnsData.filter(t => {
      const d = new Date(t.date);
      return t.type === "expense" &&
        d.getMonth() === currentMonth.getMonth() &&
        d.getFullYear() === currentMonth.getFullYear();
    });
    safeBudgetMarkup(filtered, "budget-items");
    safeBudgetMarkup(filtered, "budget-page-list");
  };

  window.updateBudgetUI = function(filteredTxns) {
    safeBudgetMarkup(filteredTxns, "budget-items");
  };

  window.sendChat = async function() {
    const input = document.getElementById("chat-input");
    const msg = input?.value.trim();
    if (!msg) return;

    const chat = document.getElementById("chat-msgs");
    if (!chat) return;

    const userWrap = document.createElement("div");
    userWrap.className = "chat-msg user";
    const userBubble = document.createElement("div");
    userBubble.className = "chat-bubble user";
    userBubble.textContent = msg;
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
      const res = await fetch("/ai/advice", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({question: msg, messages: []})
      });

      const data = await res.json();
      typing.remove();

      const aiWrap = document.createElement("div");
      aiWrap.className = "chat-msg ai";
      const aiBubble = document.createElement("div");
      aiBubble.className = "chat-bubble ai";
      aiBubble.textContent = data.advice || data.reply || "No response";
      aiWrap.appendChild(aiBubble);
      chat.appendChild(aiWrap);
    } catch (error) {
      typing.remove();
      const errWrap = document.createElement("div");
      errWrap.className = "chat-msg ai";
      const errBubble = document.createElement("div");
      errBubble.className = "chat-bubble ai";
      errBubble.textContent = "⚠️ AI is currently unavailable.";
      errWrap.appendChild(errBubble);
      chat.appendChild(errWrap);
    }

    chat.scrollTop = chat.scrollHeight;
  };

  // -----------------------------------------------------------------------
  // New Finance Insights page
  // -----------------------------------------------------------------------

  const navHost = document.querySelector(".sidebar > div:nth-of-type(2)");
  if (navHost && !document.getElementById("insights-nav-item")) {
    const item = document.createElement("div");
    item.className = "nav-item";
    item.id = "insights-nav-item";
    item.innerHTML = '<span class="nav-icon">◈</span> Financial Insights';
    navHost.appendChild(item);
    item.addEventListener("click", () => {
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");
      document.getElementById("page-insights").classList.add("active");
      document.getElementById("topbar-title").textContent = "Financial Insights";
      const content = document.getElementById("content");
      content.style.overflow = "";
      content.style.padding = "";
      loadInsightsPage();
    });
  }

  const content = document.getElementById("content");
  if (content && !document.getElementById("page-insights")) {
    const page = document.createElement("div");
    page.className = "page";
    page.id = "page-insights";
    page.innerHTML = `
      <div class="insights-hero">
        <div>
          <div class="txn-card-label">Finance intelligence</div>
          <div class="insights-title">Financial Health & Insights</div>
          <div class="insights-subtitle">Rule-based analysis from your recorded finances. No AI assumptions.</div>
        </div>
        <button class="insights-refresh" id="insights-refresh">↻ Refresh</button>
      </div>
      <div class="health-grid" id="health-grid">
        <div class="insight-loading">Loading your financial health…</div>
      </div>
      <div class="insights-columns">
        <section class="insight-panel">
          <div class="panel-heading"><span>Recurring expenses</span><span class="panel-count" id="recurring-count">0</span></div>
          <div id="recurring-list"><div class="insight-loading">Loading…</div></div>
        </section>
        <section class="insight-panel">
          <div class="panel-heading"><span>Unusual spending</span><span class="panel-count" id="anomaly-count">0</span></div>
          <div id="anomaly-list"><div class="insight-loading">Loading…</div></div>
        </section>
      </div>
      <div class="insight-note">These signals are estimates derived from recorded transactions. They are not financial or investment advice.</div>
    `;
    content.appendChild(page);
    document.getElementById("insights-refresh")?.addEventListener("click", loadInsightsPage);
  }

  async function loadInsightsPage() {
    const healthGrid = document.getElementById("health-grid");
    try {
      const data = await apiFetch("/api/insights/dashboard");
      renderHealth(data.health);
      renderRecurring(data.recurring || [], data.counts?.recurring || 0);
      renderAnomalies(data.anomalies || [], data.counts?.anomalies || 0);
    } catch (error) {
      if (healthGrid) {
        clear(healthGrid);
        const err = document.createElement("div");
        err.className = "insight-error";
        err.textContent = "Could not load insights: " + error.message;
        healthGrid.appendChild(err);
      }
    }
  }

  function renderHealth(health) {
    const el = document.getElementById("health-grid");
    if (!el) return;
    clear(el);

    const main = document.createElement("div");
    main.className = "health-score-card";
    const score = document.createElement("div");
    score.className = "health-score";
    score.textContent = health.score;
    const label = document.createElement("div");
    label.className = "health-grade";
    label.textContent = health.grade;
    const metrics = document.createElement("div");
    metrics.className = "health-metrics";
    metrics.textContent = `Savings ${health.metrics.savings_rate.toFixed(1)}% · Cash buffer ${health.metrics.months_of_buffer.toFixed(1)} months`;
    main.append(score, label, metrics);

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

    el.append(main, details);
  }

  function renderRecurring(items, total) {
    const list = document.getElementById("recurring-list");
    const count = document.getElementById("recurring-count");
    if (!list) return;
    clear(list);
    if (count) count.textContent = total;

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
      const name = document.createElement("strong");
      name.textContent = item.description || item.category;
      const meta = document.createElement("div");
      meta.className = "signal-meta";
      meta.textContent = `${item.occurrences} occurrences · every ~${item.median_interval_days} days · last ${item.last_date}`;
      left.append(name, meta);
      const amount = document.createElement("strong");
      amount.textContent = fmt(item.estimated_monthly_cost);
      row.append(left, amount);
      list.appendChild(row);
    });
  }

  function renderAnomalies(items, total) {
    const list = document.getElementById("anomaly-list");
    const count = document.getElementById("anomaly-count");
    if (!list) return;
    clear(list);
    if (count) count.textContent = total;

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
      const name = document.createElement("strong");
      name.textContent = item.description || item.category;
      const meta = document.createElement("div");
      meta.className = "signal-meta";
      meta.textContent = `${item.category} · ${item.date} · ${item.multiple_of_average}× category average`;
      left.append(name, meta);
      const amount = document.createElement("strong");
      amount.className = item.severity === "high" ? "signal-danger" : "";
      amount.textContent = fmt(item.amount);
      row.append(left, amount);
      list.appendChild(row);
    });
  }
})();