let currentPage = 'dashboard';
const API = '';
const fmt = v => '₹' + Number(v).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtDec = v => '₹' + Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
let page = 1;
let limit = 10;
let summaryData = {}, txnsData = [], budgetsData = [];
let cashflowChart = null, catChartInst = null;
let sparkCharts = {};
let selectedRange = "1M";
const CAT_COLORS = ['#22c55e','#f59e0b','#3b82f6','#ef4444','#a855f7','#f97316','#06b6d4','#84cc16'];
const getIcon = (cat) => {
  if (!cat) return '💳';
  const normalized = cat.trim().toLowerCase();

  const MAP = {
    'housing': '🏠',
    'food & drink': '🍔',
    'food': '🍔',
    'transport': '🚗',
    'shopping': '🛍',
    'entertainment': '🎮',
    'utilities': '⚡',
    'travel': '✈',
    'trip': '✈',
    'subscriptions': '📱',
    'health': '💊',
    'salary': '💼',
    'freelance': '💻',
    'investments': '📈',
    'games': '🎮',
    'emis': '🏦',
    'projects': '📁',
    'other': '📦'
  };

  return MAP[normalized] || '💳';
};
let isAllView = false;
let isMonthFilterActive = false;
function filterThisMonth() {
  isMonthFilterActive = true;
  if (currentPage !== 'transactions') {
    goPage('transactions', document.querySelectorAll('.nav-item')[1]);
  } else {
    renderAllTxns();
  }
}


async function apiFetch(path, opts={}) {
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      if (Array.isArray(j.detail)) {
        msg = j.detail.map(e => e.msg || JSON.stringify(e)).join('; ');
      } else {
        msg = j.detail || j.message || msg;
      }
    } catch(_) {}
    throw new Error(msg);
  }
  return r.json();
}

function showToast(msg, type='success') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);background:#1c1c1f;color:#f0f0f2;padding:10px 22px;border-radius:10px;font-size:13px;z-index:9999;transition:transform .3s ease,opacity .3s ease;opacity:0;pointer-events:none;border:1px solid #303035;box-shadow:0 4px 20px rgba(0,0,0,.4)';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.borderColor = type === 'error' ? '#ef4444' : '#22c55e';
  toast.style.color = type === 'error' ? '#ef4444' : '#f0f0f2';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(80px)'; toast.style.opacity = '0'; }, 3000);
}

function setGreeting() {
  const h = new Date().getHours();
  document.getElementById('greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function makeSparkline(id, data, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (sparkCharts[id]) sparkCharts[id].destroy();
  sparkCharts[id] = new Chart(ctx, {
    type:'line',
    data:{labels:data.map((_,i)=>i),datasets:[{data,borderColor:color,borderWidth:1.5,fill:true,backgroundColor:color.replace(')',',0.08)').replace('rgb','rgba').replace('#','').replace(/^([0-9a-f]{6})$/i,(_,h)=>`rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},0.08)`),tension:0.4,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}},animation:false}
  });
}

function buildSparkFromMonthly(monthly, field) {
  return Object.keys(monthly).sort().map(m => monthly[m][field] || 0);
}

async function loadSummary() {
  try {
    summaryData = await apiFetch('/summary');
    const {income=0, expense=0, balance=0, savings_rate=0, monthly={}} = summaryData;
    const months = Object.keys(monthly).sort();

let prevInc = 0;
let prevExp = 0;

if (months.length >= 2) {
  const prev = monthly[months[months.length - 2]];
  prevInc = prev?.income || 0;
  prevExp = prev?.expense || 0;
}

if (months.length === 1) {
  const curr = monthly[months[0]];
  prevInc = curr.income;
  prevExp = curr.expense;
}

const incChange = calcChange(income, prevInc);
const expChange = calcChange(expense, prevExp);

    document.getElementById('s-bal').textContent = fmtDec(balance);
    document.getElementById('s-inc').textContent = fmtDec(income);
    document.getElementById('s-exp').textContent = fmtDec(expense);
    document.getElementById('s-sav').textContent = savings_rate.toFixed(1) + '%';
    updateBadge('badge-inc', incChange);
    updateBadge('badge-exp', expChange);
    const balPrev = prevInc - prevExp;
    updateBadge('badge-bal', balPrev ? ((balance - balPrev) / balPrev) * 100 : 0);
    document.getElementById('cf-amount').textContent = fmtDec(balance);
    document.getElementById('leg-inc').textContent = fmt(income);
    document.getElementById('leg-exp').textContent = fmt(expense);
    document.getElementById('cat-total').textContent = fmt(expense);
    const now = new Date();
    document.getElementById('cat-period').textContent = 'All time';
    document.getElementById('hero-sub').textContent = savings_rate >= 20
      ? `Your savings rate is ${savings_rate.toFixed(1)}% — great work! Keep it going with a few quick wins from FinanceAI.`
      : `Your overall savings rate is ${savings_rate.toFixed(1)}%. Let's find ways to improve it together.`;
    const incArr = buildSparkFromMonthly(monthly,'income');
    const expArr = buildSparkFromMonthly(monthly,'expense');
    const balArr = incArr.map((v,i)=>v-(expArr[i]||0));
    const savArr = incArr.map((v,i)=>v>0?((v-(expArr[i]||0))/v*100):0);
    setTimeout(()=>{
      makeSparkline('spark-bal',balArr.length?balArr:[0,0,balance],'#22c55e');
      makeSparkline('spark-inc',incArr.length?incArr:[0,0,income],'#22c55e');
      makeSparkline('spark-exp',expArr.length?expArr:[0,0,expense],'#ef4444');
      makeSparkline('spark-sav',savArr.length?savArr:[0,0,savings_rate],'#f59e0b');
    },100);
const categoryExpenses = txnsData.filter(t => t.type === "expense");

const grouped = {};

categoryExpenses.forEach(t => {
  if (!grouped[t.category]) grouped[t.category] = 0;
  grouped[t.category] += Number(t.amount);
});

renderCatChart(grouped);
    renderCashflowChart(monthly);
    renderInsights(income, expense, savings_rate, grouped);
  } catch(e) { console.error('Summary error',e); }
}

function renderCashflowChart(monthly) {
  const months = Object.keys(monthly).sort();
  const labels = months.map(m=>{const [y,mo]=m.split('-');return new Date(y,parseInt(mo)-1).toLocaleDateString('en-US',{month:'short'})});
  const inc = months.map(m=>monthly[m].income||0);
  const exp = months.map(m=>monthly[m].expense||0);
  const ctx = document.getElementById('cashflowChart').getContext('2d');
  if (cashflowChart) cashflowChart.destroy();
  cashflowChart = new Chart(ctx, {
    type:'line',
    data:{labels,datasets:[
      {label:'Income',data:inc,borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,0.07)',fill:true,tension:0.4,borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:'#22c55e'},
      {label:'Expenses',data:exp,borderColor:'#ef4444',backgroundColor:'rgba(239,68,68,0.06)',fill:true,tension:0.4,borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:'#ef4444'}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c1c1f',borderColor:'#303035',borderWidth:1,titleColor:'#9191a0',bodyColor:'#f0f0f2',padding:10,callbacks:{label:c=>' '+fmt(c.parsed.y)}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#5a5a6a',font:{size:11}}},
        y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#5a5a6a',font:{size:11},callback:v=>'₹'+Number(v).toLocaleString('en-IN')},beginAtZero:true}
      }
    }
  });
}

function setRange(range, el) {
  selectedRange = range;

  document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');

  updateDashboardByRange();
}

function updateDashboardByRange() {
  const filtered = getFilteredTransactions();
  const cats = getCategoryTotals(filtered);

  renderCatChart(cats);
  updateBudgetUI(filtered);

  document.getElementById('cat-period').textContent =
    selectedRange === 'All'
      ? 'All time'
      : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function getFilteredTransactions() {
  const now = new Date();
  let months = 1;

  if (selectedRange === "3M") months = 3;
  else if (selectedRange === "6M") months = 6;
  else if (selectedRange === "1Y") months = 12;
  else if (selectedRange === "All") return txnsData;

  const pastDate = new Date();
  pastDate.setMonth(now.getMonth() - months);

  return txnsData.filter(t => new Date(t.date) >= pastDate);
}
function updateBudgetUI(filteredTxns) {
  const cats = {};

  filteredTxns.forEach(t => {
    if (t.type === "expense") {
      if (!cats[t.category]) cats[t.category] = 0;
      cats[t.category] += Number(t.amount);
    }
  });

  const el = document.getElementById('budget-items');

  el.innerHTML = budgetsData.map(b => {
    const spent = cats[b.category] || 0;
    const pct = Math.min(100, (spent / b.limit_amt) * 100);
    const cls = pct >= 100 ? 'red' : pct >= 80 ? 'yellow' : 'green';
    const remaining = b.limit_amt - spent;
    const over = pct >= 100;

    return `
      <div class="budget-item">
        <div class="budget-item-header">
          <div class="budget-item-left">
            <div class="budget-icon">${getIcon(b.category)}</div>
            <span class="budget-name">${escapeHtml(b.category)}</span>
          </div>

          <div class="budget-amounts ${over ? 'over' : 'ok'}">
            <div class="amount-main">
              ${fmt(spent)} / ${fmt(b.limit_amt)}
            </div>
            <div class="amount-sub">
              ${over ? `Over by ${fmt(Math.abs(remaining))}` : `Remaining ${fmt(remaining)}`}
            </div>
          </div>
        </div>

        <div class="budget-bar">
          <div class="budget-fill ${cls}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}
function renderCatChart(cats) {
  const entries = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (!entries.length) return;
  const total = entries.reduce((s,e)=>s+e[1],0);
  const ctx = document.getElementById('catChart').getContext('2d');
  if (catChartInst) catChartInst.destroy();
  catChartInst = new Chart(ctx, {
    type:'doughnut',
    data:{labels:entries.map(e=>e[0]),datasets:[{data:entries.map(e=>e[1]),backgroundColor:CAT_COLORS.slice(0,entries.length),borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'72%',plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c1c1f',borderColor:'#303035',borderWidth:1,titleColor:'#9191a0',bodyColor:'#f0f0f2',callbacks:{label:c=>' '+fmt(c.parsed)}}}}
  });
  document.getElementById('cat-list').innerHTML = entries.map((e,i)=>`
    <div class="cat-row">
      <span class="cat-name"><span class="cat-dot" style="background:${CAT_COLORS[i]}"></span>${escapeHtml(e[0])}</span>
      <span class="cat-pct">${total>0?Math.round(e[1]/total*100):0}%</span>
      <span class="cat-amount">${fmt(e[1])}</span>
    </div>`).join('');
}

async function loadTransactions() {
  try {
    txnsData = await apiFetch('/transactions');
    document.getElementById('txn-count-badge').textContent = txnsData.length;
    renderRecentTxns(txnsData.slice(0,6));
    renderAllTxns(txnsData);
  } catch(e) {
    document.getElementById('recent-txns').innerHTML = 'Error loading transactions';
  }
}

function renderRecentTxns(txns) {
  document.getElementById('recent-txns').innerHTML = txns.length
    ? txns.map(t=>txnRow(t,false)).join('')
    : '<div class="empty-state">No transactions yet</div>';
}

function renderAllTxns(data = txnsData) {
  const search = (document.getElementById('search-input') || {}).value?.toLowerCase() || '';
  const now = new Date();
  const periodData = isMonthFilterActive
    ? data.filter(t => {
        const date = new Date(t.date);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      })
    : data;

  const filtered = search
    ? periodData.filter(t =>
        (t.description || t.desc || '').toLowerCase().includes(search) ||
        (t.category || '').toLowerCase().includes(search)
      )
    : periodData;

  document.getElementById('all-txns').innerHTML = filtered.length
    ? filtered.map(t => fullTxnRow(t)).join('')
    : '<div class="empty-state">No transactions found</div>';
}

function txnRow(t, showDel=false) {
  const inc = t.type==='income';
  const icon = getIcon(t.category);
  const bg = inc ? 'rgba(34,197,94,0.1)' : `rgba(${hashColor(t.category)},0.1)`;
  const aname = getAccountName(t.account_id);
  const desc = t.description || t.desc || t.category;
  return `<div class="txn-item">
    <div class="txn-icon" style="background:${bg}">${icon}</div>
    <div class="txn-info"><div class="txn-name">${escapeHtml(desc)}</div><div class="txn-meta">${escapeHtml(t.category)}${aname ? ' · '+escapeHtml(aname) : ''} • ${escapeHtml(t.date)}</div></div>
    <span class="txn-amount ${inc?'inc':'exp'}">${inc?'+':'-'}<span class="txn-trend">${inc?'↗':'↘'}</span>${fmtDec(t.amount)}</span>
  </div>`;
}

function fullTxnRow(t) {
  const inc = t.type==='income';
  const icon = getIcon(t.category);
  const bg = inc ? 'rgba(34,197,94,0.1)' : `rgba(${hashColor(t.category)},0.1)`;
  const aname = getAccountName(t.account_id);
  const desc = t.description || t.desc || t.category;
  return `<div class="full-txn-item">
    <div class="txn-icon" style="background:${bg}">${icon}</div>
    <div class="txn-info"><div class="txn-name">${escapeHtml(desc)}</div><div class="txn-meta">${escapeHtml(t.category)}${aname ? ' · '+escapeHtml(aname) : ''} • ${escapeHtml(t.date)}</div></div>
    <span class="cat-badge" style="background:var(--bg3);color:var(--text2);padding:3px 8px;border-radius:5px;font-size:11px">${escapeHtml(t.category)}</span>
    <span class="txn-amount ${inc?'inc':'exp'}">${inc?'+':'-'}${fmtDec(t.amount)}</span>
    <button class="edit-btn" onclick="openEditModal(${t.id})" title="Edit">✏️</button>
    <button class="del-btn" onclick="deleteTxn(${t.id})">Delete</button>
  </div>`;
}

function hashColor(str) {
  const colors = ['239,68,68','245,158,11','59,130,246','168,85,247','249,115,22','6,182,212'];
  let h=0; for(let c of str) h=(h<<5)-h+c.charCodeAt(0); return colors[Math.abs(h)%colors.length];
}

async function addTransaction() {
  const type=document.getElementById('t-type').value, amount=parseFloat(document.getElementById('t-amount').value);
  const category=document.getElementById('t-category').value.trim(), date=document.getElementById('t-date').value;
  const description=(document.getElementById('t-desc') ? document.getElementById('t-desc').value.trim() : '') || category;
  if(!amount||!category||!date){alert('Fill all fields');return;}
  await apiFetch('/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,amount,description,category,date})});
  document.getElementById('t-amount').value=''; document.getElementById('t-category').value='';
  if(document.getElementById('t-desc')) document.getElementById('t-desc').value='';
  refreshCurrentPage();
}

async function deleteTxn(id) {
  await apiFetch('/transactions/' + id, { method: 'DELETE' });
  refreshCurrentPage();
}

async function loadBudgets() {
  try {
    budgetsData = await apiFetch('/budgets');
    renderBudgets();
    document.getElementById('budget-count-badge').textContent = budgetsData.length;
    document.getElementById('budget-count-header').textContent = budgetsData.length + ' active budget' + (budgetsData.length!==1?'s':'');
  } catch(e){}
}

function renderBudgets() {
  let budgetView = "monthly";
  const now = new Date();

const monthlyExpenses = txnsData.filter(t => {
  const d = new Date(t.date);
  return (
    t.type === "expense" &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
});

const cats = {};

monthlyExpenses.forEach(t => {
  if (!cats[t.category]) cats[t.category] = 0;
  cats[t.category] += Number(t.amount);
});
  const el = document.getElementById('budget-items');
  const elPage = document.getElementById('budget-page-list');
  if (!budgetsData.length) {
    el.innerHTML='<div class="empty-state">No budgets set. <span class="link-btn green" onclick="goPage(\'budgets\',document.querySelectorAll(\'.nav-item\')[3])" style="cursor:pointer">Add one →</span></div>';
    elPage.innerHTML='<div class="empty-state" style="grid-column:1/-1">No budgets yet</div>';
    return;
  }
  el.innerHTML = budgetsData.map(b => {
  const spent = cats[b.category] || 0;
  const pct = b.limit_amt > 0 ? Math.min(100, (spent / b.limit_amt) * 100) : 0;
  const cls = pct >= 100 ? 'red' : pct >= 80 ? 'yellow' : 'green';
  const over = pct >= 100;
  const remaining = b.limit_amt - spent;

  return `
    <div class="budget-item">

      <div class="budget-item-header">
        <div class="budget-item-left">
          <div class="budget-icon">${getIcon(b.category)}</div>
          <span class="budget-name">${escapeHtml(b.category)}</span>
        </div>

        <div class="budget-amounts ${over ? 'over' : 'ok'}">
          <div class="amount-main">
            ${fmt(spent)} / ${fmt(b.limit_amt)}
          </div>
          <div class="amount-sub">
            ${over 
              ? `Over by ${fmt(Math.abs(remaining))}` 
              : `Remaining ${fmt(remaining)}`
            }
          </div>
        </div>
      </div>

      <div class="budget-bar">
        <div class="budget-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>
      </div>

    </div>
  `;
}).join('');
  elPage.innerHTML = budgetsData.map(b=>{
    const spent = cats[b.category] || 0;
const pct = Math.min(100,(spent/b.limit_amt)*100);
const cls = pct>=100?'red':pct>=80?'yellow':'green';
const over = pct>=100;
const remaining = b.limit_amt - spent;
    return `<div class="budget-page-item">
      <div class="bpi-header">
        <div style="display:flex;align-items:center;gap:10px"><div class="budget-icon" style="width:32px;height:32px;background:var(--bg3);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px">${getIcon(b.category)}</div><span class="bpi-name">${escapeHtml(b.category)}</span></div>
        <button class="del-btn" onclick="deleteBudget(decodeURIComponent('${encodeURIComponent(b.category).replace(/'/g, '%27')}'))">Remove</button>
      </div>
      <div class="bpi-amounts">
  <span>Spent: ${fmt(spent)}</span>
  <span>Limit: ${fmt(b.limit_amt)}</span>
</div>

<div style="font-size:11px; margin-top:6px; color:${over ? 'var(--red)' : 'var(--text3)'}">
  ${
    over
      ? `Over by ${fmt(Math.abs(remaining))}`
      : `Remaining ${fmt(remaining)}`
  }
</div>
      <div class="budget-bar" style="height:6px"><div class="budget-fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">${pct.toFixed(0)}% used${over?' · Over budget!':pct>=80?' · Near limit':''}</div>
    </div>`;
  }).join('');
}

async function addBudget() {
  const category=document.getElementById('b-cat').value.trim(), limit_amt=parseFloat(document.getElementById('b-limit').value);
  if(!category||!limit_amt){alert('Fill both fields');return;}
  await apiFetch('/budgets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,limit_amt})});
  document.getElementById('b-cat').value=''; document.getElementById('b-limit').value='';
  refreshCurrentPage();
}

async function deleteBudget(cat) {
  if(!confirm('Remove budget for '+cat+'?'))return;
  await apiFetch('/budgets/'+encodeURIComponent(cat),{method:'DELETE'});
  await loadBudgets();
}

function renderInsights(income, expense, savings_rate, cats) {
  const top = Object.entries(cats||{}).sort((a,b)=>b[1]-a[1])[0];
  const items = [];
  if (top && income > 0) {
    const pct = Math.round(top[1]/income*100);
    items.push({type:'warn', icon:'⚡', title:`You could save ${fmt(Math.max(0,top[1]*0.15))} this month`, body:`${escapeHtml(top[0])} spend is ${pct}% of income. Cutting it by 15% would free up ${fmt(top[1]*0.15)} toward your emergency fund.`, action:'Adjust budget →'});
  }
  let title, body;
  if (savings_rate >= 40) {
    title = 'Excellent savings rate 🚀';
    body = `You're saving ${savings_rate.toFixed(1)}%. You're far ahead of the ideal 20%!`;
  } else if (savings_rate >= 20) {
    title = 'On track 👍';
    body = `You're saving ${savings_rate.toFixed(1)}%. Keep it consistent.`;
  } else {
    title = 'Needs improvement ⚠️';
    body = `Your savings rate is ${savings_rate.toFixed(1)}%. Aim for at least 20%.`;
  }
  items.push({ type: savings_rate >= 20 ? 'ok' : 'warn', icon: '📊', title, body });
  document.getElementById('insights-list').innerHTML = items.length
    ? items.map(i=>`<div class="insight-item"><div class="insight-item-header"><div class="insight-bullet ${i.type}">${i.icon}</div><div><div class="insight-text-title">${escapeHtml(i.title)}</div><div class="insight-text-body">${escapeHtml(i.body)}</div>${i.action?`<span class="insight-action">${escapeHtml(i.action)}</span>`:''}</div></div></div>`).join('')
    : '<div class="empty-state">Add transactions to see insights</div>';
}

// ── Accounts CRUD ──────────────────────────────────────────
let accountsData = [];

async function loadAccounts() {
  try {
    accountsData = await apiFetch('/accounts');
    renderAccounts();
  } catch(e) { console.error('loadAccounts error', e); }
}

function renderAccounts() {
  const el = document.getElementById('accounts-list');
  if (!el) return;
  if (!accountsData.length) {
    el.innerHTML = '<div class="empty-state">No accounts yet</div>';
    return;
  }
  el.innerHTML = accountsData.map(a => `
    <div class="account-card">
      <div class="account-top">
        <span class="account-name">${escapeHtml(a.name)}</span>
        <span class="account-badge">${escapeHtml(a.type)}</span>
      </div>
      <div class="account-bal">${fmtDec(a.balance)}</div>
      <div class="account-actions">
        <button class="edit-btn" onclick="editAccount(${a.id})" title="Edit">✏️</button>
        <button class="del-btn" onclick="deleteAccount(${a.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

let editingAccountId = null;

function openAccountModal(data) {
  editingAccountId = data ? data.id : null;
  document.getElementById('account-modal-title').textContent = data ? 'Edit Account' : 'Add Account';
  document.getElementById('ac-name').value = data ? data.name : '';
  document.getElementById('ac-balance').value = data ? data.balance : '';
  document.getElementById('ac-type').value = data ? data.type : 'checking';
  document.getElementById('modal-account').classList.add('open');
}

function closeAccountModal() {
  document.getElementById('modal-account').classList.remove('open');
  editingAccountId = null;
}

async function saveAccount() {
  const name = document.getElementById('ac-name').value.trim();
  const balance = parseFloat(document.getElementById('ac-balance').value);
  const type = document.getElementById('ac-type').value;
  if (!name) { alert('Enter account name'); return; }
  if (editingAccountId) {
    await apiFetch('/accounts/' + editingAccountId, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, balance, type}) });
  } else {
    await apiFetch('/accounts', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, balance, type}) });
  }
  closeAccountModal();
  await loadAccounts();
  await loadSummary();
}

async function deleteAccount(id) {
  if (!confirm('Delete this account?')) return;
  await apiFetch('/accounts/' + id, { method:'DELETE' });
  await loadAccounts();
  await loadSummary();
}

async function editAccount(id) {
  const a = accountsData.find(x => x.id === id);
  if (a) openAccountModal(a);
}

document.getElementById('modal-account')?.addEventListener('click', e => { if (e.target === document.getElementById('modal-account')) closeAccountModal(); });

// ── Edit Transaction Modal ─────────────────────────────────
let editingTxnId = null;

function openEditModal(id) {
  editingTxnId = id;
  const t = txnsData.find(x => x.id === id);
  if (!t) return;
  document.getElementById('me-type').value = t.type;
  document.getElementById('me-amount').value = t.amount;
  if (document.getElementById('me-desc')) document.getElementById('me-desc').value = t.description || t.desc || '';
  document.getElementById('me-category').value = t.category;
  document.getElementById('me-date').value = t.date;
  populateAccountSelect('me-account', t.account_id);
  document.getElementById('modal-edit').classList.add('open');
}

function closeEditModal() {
  document.getElementById('modal-edit').classList.remove('open');
  editingTxnId = null;
}

async function saveEdit() {
  const type = document.getElementById('me-type').value;
  const amount = parseFloat(document.getElementById('me-amount').value);
  const description = (document.getElementById('me-desc') ? document.getElementById('me-desc').value.trim() : '');
  const category = document.getElementById('me-category').value.trim();
  const date = document.getElementById('me-date').value;
  const aid = document.getElementById('me-account').value;
  if (!amount || !category || !date) { alert('Fill all fields'); return; }
  await apiFetch('/transactions/' + editingTxnId, {
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type, amount, description: description || category, category, date, account_id: aid || null})
  });
  closeEditModal();
  refreshCurrentPage();
}

document.getElementById('modal-edit')?.addEventListener('click', e => { if (e.target === document.getElementById('modal-edit')) closeEditModal(); });

// ── CSV Import ─────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function normalizeDate(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // M/D/YY or M/D/YYYY or MM/DD/YY or MM/DD/YYYY
  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let [, m, d, y] = slashMatch;
    if (y.length === 2) {
      const yi = parseInt(y);
      y = (yi > 50 ? '19' : '20') + y;
    }
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // DD-MM-YYYY (try parse with Date)
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  let text;
  try { text = await file.text(); } catch(e) { showToast('Cannot read file', 'error'); input.value = ''; return; }

  const rawLines = text.split(/\r?\n/).filter(l => l.trim());
  if (rawLines.length < 2) { showToast('CSV has no data rows', 'error'); input.value = ''; return; }

  const headers = parseCSVLine(rawLines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g,''));
  const results = [];
  const skipped = [];

  for (let i = 1; i < rawLines.length; i++) {
    const vals = parseCSVLine(rawLines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });

    const amount = parseFloat(row.amount);
    const category = row.category || row.cat || '';
    if (!amount || isNaN(amount) || !category) { skipped.push(i + 1); continue; }

    const type = (row.type || 'expense').toLowerCase();
    results.push({
      type: ['income','expense'].includes(type) ? type : 'expense',
      amount: Math.abs(amount),
      category,
      description: row.description || row.desc || row.note || category,
      date: normalizeDate(row.date),
      account_id: row.account_id ? parseInt(row.account_id) : null
    });
  }

  input.value = '';

  if (!results.length) {
    showToast(`No valid rows found${skipped.length ? ' (rows skipped: ' + skipped.join(', ') + ')' : ''}`, 'error');
    return;
  }

  try {
    const res = await apiFetch('/transactions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results)
    });
    const msg = `✓ Imported ${res.imported} transaction${res.imported !== 1 ? 's' : ''}${skipped.length ? ' (' + skipped.length + ' rows skipped)' : ''}`;
    showToast(msg);
    await loadTransactions();
    await loadSummary();
  } catch(e) {
    showToast('Import failed: ' + e.message, 'error');
  }
}

function getAccountName(id) {
  const a = accountsData.find(x => x.id === id);
  return a ? a.name : '';
}

function populateAccountSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— None —</option>' +
    accountsData.map(a => `<option value="${a.id}"${selectedId && a.id === selectedId ? ' selected' : ''}>${escapeHtml(a.name)}${a.type ? ' (' + escapeHtml(a.type) + ')' : ''}</option>`).join('');
}

let lastModalTrigger = null;

function openModal(trigger = document.activeElement) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  lastModalTrigger = trigger;
  modal.classList.add('open');
  document.body.classList.add('modal-open');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('m-date').value = new Date().toISOString().slice(0,10);
  if (document.getElementById('m-desc')) document.getElementById('m-desc').value = '';
  populateAccountSelect('m-account');
  requestAnimationFrame(() => document.getElementById('m-type')?.focus());
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  lastModalTrigger?.focus?.();
}

function closeSidebar() {
  const wasOpen = document.body.classList.contains('sidebar-open');
  document.body.classList.remove('sidebar-open');
  const hamburger = document.querySelector('.hamburger');
  hamburger?.setAttribute('aria-expanded', 'false');
  if (wasOpen) hamburger?.focus();
}
async function submitModal() {
  const type=document.getElementById('m-type').value, amount=parseFloat(document.getElementById('m-amount').value);
  const category=document.getElementById('m-category').value.trim(), date=document.getElementById('m-date').value;
  const description=(document.getElementById('m-desc') ? document.getElementById('m-desc').value.trim() : '') || category;
  const aid=document.getElementById('m-account').value;
  if(!amount||!category||!date){alert('Fill all fields');return;}
  await apiFetch('/transactions',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type,amount,description,category,date,account_id:aid||null})
  });
  closeModal();
  document.getElementById('m-amount').value=''; document.getElementById('m-category').value='';
  if (document.getElementById('m-desc')) document.getElementById('m-desc').value='';
  refreshCurrentPage();
}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))closeModal();});

function goPage(name, el) {
  currentPage = name;

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.classList.remove('active');
    n.removeAttribute('aria-current');
  });

  document.getElementById('page-'+name).classList.add('active');
  if(el) {
    el.classList.add('active');
    el.setAttribute('aria-current', 'page');
  }
  if (window.matchMedia('(max-width: 1024px)').matches) closeSidebar();

  const titles = {
    dashboard:'Overview',
    transactions:'Transactions',
    budgets:'Budgets',
    accounts:'Accounts',
    'ai-page':'AI Assistant'
  };

  document.getElementById('topbar-title').textContent = titles[name]||name;

  // AI page manages its own internal scroll; suppress .content scroll for it
  const content = document.getElementById('content');
  if (name === 'ai-page') {
    content.style.overflow = 'hidden';
    content.style.padding = '0';
  } else {
    content.style.overflow = '';
    content.style.padding = '';
  }

  // Always refresh data when navigating to a page
  refreshCurrentPage();
}

document.getElementById('search-input').addEventListener('input', ()=>renderAllTxns(txnsData));

async function initApp() {
  await Promise.all([loadTransactions(), loadBudgets(), loadAccounts()]);
  await loadSummary();
}
async function refreshAll() {
  await Promise.all([loadTransactions(), loadBudgets(), loadAccounts()]);
  await loadSummary();
}

document.getElementById('t-date').value = new Date().toISOString().slice(0,10);
document.getElementById('m-date').value = new Date().toISOString().slice(0,10);
setGreeting();
(function loadTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light');
  }
})();
refreshAll();
const container = document.getElementById('all-txns');

if (container) {
  // Infinite scroll placeholder — backend pagination can be added later
  // container.addEventListener('scroll', () => { … });
}
function toggleTheme() {
  const body = document.body;

  if (body.classList.contains('light')) {
    body.classList.remove('light');
    localStorage.setItem('theme', 'dark');
  } else {
    body.classList.add('light');
    localStorage.setItem('theme', 'light');
  }
}

function toggleSidebar() {
  const isOpen = document.body.classList.toggle('sidebar-open');
  const hamburger = document.querySelector('.hamburger');
  hamburger?.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
    requestAnimationFrame(() => document.querySelector('.sidebar .nav-item')?.focus());
  } else {
    hamburger?.focus();
  }
}

function updateViewportHeight() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
}

window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (document.body.classList.contains('sidebar-open')) closeSidebar();
  if (document.getElementById('modal')?.classList.contains('open')) closeModal();
});

window.addEventListener('resize', updateViewportHeight, { passive: true });
window.visualViewport?.addEventListener('resize', updateViewportHeight, { passive: true });
window.visualViewport?.addEventListener('scroll', updateViewportHeight, { passive: true });
updateViewportHeight();
function calcChange(current, previous) {
  if (!previous || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}
function updateBadge(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  const v = Math.round(value);

  el.classList.remove("up", "down");

  if (v > 0) {
    el.textContent = "+" + v + "%";
    el.classList.add("up");
  } else if (v < 0) {
    el.textContent = v + "%";
    el.classList.add("down");
  } else {
    el.textContent = "0%";
  }
}
function refreshCurrentPage() {
  if (currentPage === 'transactions') {
    loadTransactions();
  } else if (currentPage === 'budgets') {
    loadBudgets();
    renderBudgets();
  } else if (currentPage === 'accounts') {
    loadAccounts();
  } else if (currentPage === 'dashboard') {
    loadTransactions().then(() => loadSummary());
  } else {
    loadTransactions();
  }
}
document.getElementById("view-all-expenses").addEventListener("click", () => {
  if (isAllView) {
    showMonthlyExpenses();
  } else {
    showAllExpenses();
  }

  isAllView = !isAllView;
});
function getCategoryTotals(filteredTxns) {
  const cats = {};

  filteredTxns.forEach(t => {
    if (t.type === "expense") {
      if (!cats[t.category]) cats[t.category] = 0;
      cats[t.category] += Number(t.amount);
    }
  });

  return cats;
}
function showAllExpenses() {
  const cats = getCategoryTotals(txnsData);

  renderCatChart(cats);
  updateBudgetUI(txnsData);

  document.getElementById("cat-period").textContent = "All time";
  document.getElementById("view-all-expenses").textContent = "This month";
}
function showMonthlyExpenses() {
  const now = new Date();

  const monthly = txnsData.filter(t => {
    const d = new Date(t.date);
    return (
      t.type === "expense" &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  });

  const cats = getCategoryTotals(monthly);

  renderCatChart(cats);
  updateBudgetUI(monthly);

  document.getElementById("cat-period").textContent =
    now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  document.getElementById("view-all-expenses").textContent = "View all";
}
async function sendChat() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;

  const chat = document.getElementById("chat-msgs");

  chat.innerHTML += `
    <div class="chat-msg user">
      <div class="chat-bubble user">${escapeHtml(msg)}</div>
    </div>
  `;

  input.value = "";

  chat.innerHTML += `
    <div class="chat-msg ai" id="typing">
      <div class="chat-bubble ai">I'm analyzing your finances... 📊</div>
    </div>
  `;

  chat.scrollTop = chat.scrollHeight;

  try {
    const res = await fetch("/ai/advice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: msg,
        transactions: txnsData,
        summary: summaryData,
        budgets: budgetsData
      })
    });

    const data = await res.json();

    document.getElementById("typing")?.remove();

    chat.innerHTML += `
      <div class="chat-msg ai">
        <div class="chat-bubble ai">
          ${escapeHtml(data.advice || "No response")}
        </div>
      </div>
    `;

  } catch (err) {
    document.getElementById("typing")?.remove();

    chat.innerHTML += `
      <div class="chat-msg ai">
        <div class="chat-bubble ai">⚠️ AI error. Check server.</div>
      </div>
    `;
  }

  chat.scrollTop = chat.scrollHeight;
}
function quickAsk(text, el) {
  document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');

  const input = document.getElementById("chat-input");
  input.value = text;
  sendChat();
}
