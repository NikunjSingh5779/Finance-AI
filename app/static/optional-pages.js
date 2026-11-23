export function createOptionalPages({
  $, apiFetch, fmt, fmtDec, showToast, setCurrentPage, loadNetWorthChart
}) {
  let featureStylesPromise;

  function ensureFeatureStylesheet() {
    if (!featureStylesPromise) {
      featureStylesPromise = new Promise(resolve => {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        const stylesheetUrl = new URL("./insights.css", import.meta.url);
        const version = new URL(import.meta.url).searchParams.get("v");
        if (version) stylesheetUrl.searchParams.set("v", version);
        stylesheet.href = stylesheetUrl.href;
        stylesheet.onload = resolve;
        stylesheet.onerror = () => {
          console.warn("Insights and Planning styles could not be loaded.");
          resolve();
        };
        document.head.appendChild(stylesheet);
      });
    }
    return featureStylesPromise;
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
    const title = document.createElement("h1");
    title.className = "insights-title";
    title.textContent = "Financial Health & Insights";
    const subtitle = document.createElement("div");
    subtitle.className = "insights-subtitle";
    subtitle.textContent = "Explainable signals calculated from your recorded finances.";
    heroText.append(title, subtitle);

    const refresh = document.createElement("button");
    refresh.type = "button";
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

  async function activateInsights() {
    await ensureFeatureStylesheet();
    createInsightsPage();
    setCurrentPage("insights");
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
    await ensureFeatureStylesheet();
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
      `Savings ${Number(health.metrics?.savings_rate || 0).toFixed(1)}%, cash buffer ${Number(health.metrics?.months_of_buffer || 0).toFixed(1)} months`;
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

  function createPlanningPage() {
    if ($("page-planning")) return;
    const page = document.createElement("div");
    page.className = "page";
    page.id = "page-planning";

    const hero = document.createElement("div");
    hero.className = "planning-hero";
    const heroText = document.createElement("div");
    const title = document.createElement("h1");
    title.className = "planning-title";
    title.textContent = "Goals, Net Worth & Monthly Report";
    const subtitle = document.createElement("div");
    subtitle.className = "planning-subtitle";
    subtitle.textContent = "Track what you are building, what you own, and how the month went.";
    heroText.append(title, subtitle);
    const refresh = document.createElement("button");
    refresh.type = "button";
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
      input.setAttribute("aria-label", placeholder);
      if (id === "goal-category") input.value = "Savings";
      if (type === "number") { input.min = id === "goal-target" ? "0.01" : "0"; input.step = "0.01"; }
      form.appendChild(input);
    });
    const addButton = document.createElement("button");
    addButton.type = "button";
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
    month.setAttribute("aria-label", "Report month");
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

  async function activatePlanning() {
    await ensureFeatureStylesheet();
    createPlanningPage();
    setCurrentPage("planning");
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
    await ensureFeatureStylesheet();
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
      await renderNetWorth();
      await loadMonthlyReport();
    } catch (error) { showToast("Could not load planning data: " + error.message, "error"); }
  }

  async function renderNetWorth() {
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
    let trendSection;
    if (netWorthHistory.length) {
      trendSection = document.createElement("div");
      trendSection.className = "wealth-trend-wrap";
      const trendTitle = document.createElement("div");
      trendTitle.className = "report-list-title";
      trendTitle.textContent = "Net worth trend";
      const canvas = document.createElement("canvas");
      canvas.id = "net-worth-chart";
      canvas.height = 90;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Net worth trend for the last twelve months");
      trendSection.append(trendTitle, canvas);
    } else {
      trendSection = document.createElement("div");
      trendSection.className = "wealth-trend-empty";
      trendSection.textContent = "Your net worth trend will appear after you add financial accounts and record balances over time.";
    }

    const breakdown = document.createElement("div"); breakdown.className = "wealth-breakdown";
    [...(netWorthData.assets || []), ...(netWorthData.liabilities || [])].forEach(item => {
      const row=document.createElement("div"); row.className="wealth-row";
      const name=document.createElement("span"); name.textContent=item.name;
      const kind=document.createElement("span"); kind.className="wealth-type"; kind.textContent=item.type;
      const amount=document.createElement("strong"); amount.textContent=fmtDec(item.type === "credit" ? -item.balance : item.balance);
      row.append(name,kind,amount); breakdown.appendChild(row);
    });
    const chart = $("net-worth-chart");
    if (chart && netWorthHistory.length) {
      try { await loadNetWorthChart(chart, netWorthHistory); }
      catch (error) { console.warn("Net worth chart is unavailable", error); }
    }
    card.append(header,summary,trendSection,breakdown);
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
      const update=document.createElement("button");
      update.type = "button"; update.className="goal-action"; update.textContent="Update"; update.addEventListener("click",()=>updateGoalPrompt(goal));
      const remove=document.createElement("button");
      remove.type = "button"; remove.className="goal-action danger"; remove.textContent="Delete"; remove.addEventListener("click",()=>deleteGoal(goal.id));
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

  return { activateInsights, activatePlanning, loadInsightsPage, loadPlanningPage };
}
