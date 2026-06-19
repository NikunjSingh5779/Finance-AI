let currentPage = 'dashboard';
const API = 'http://localhost:8000';
const fmt = v => '₹' + Number(v).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtDec = v => '₹' + Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
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
function filterThisMonth() {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const filtered = txnsData.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  renderAllTxns(filtered);
}
async function loadMoreTxns() {
  const data = await apiFetch(`/transactions?page=${page}&limit=${limit}`);
  txnsData = [...txnsData, ...data];
  renderAllTxns(txnsData);
  page++;
}
function initAIChat() {
  const chatBox = document.getElementById('chat-msgs');
  if (!chatBox) return;

  if (chatBox.innerHTML.trim() !== '') return;

  chatBox.innerHTML = `
    <div class="chat-msg ai">
      <div class="chat-bubble ai">
        👋 Hi! I'm your Finance AI.
        How can I help you today?
      </div>
    </div>
  `;
}

async function apiFetch(path, opts={}) {
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function setGreeting() {
  const h = new Date().getHours();
  document.getElementById('greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function makeSparkline(id, data, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.offsetWidth || 180;
  canvas.height = 40;
  if (sparkCharts[id]) sparkCharts[id].destroy();
  sparkCharts[id] = new Chart(ctx, {
    type:'line',
    data:{labels:data.map((_,i)=>i),datasets:[{data,borderColor:color,borderWidth:1.5,fill:true,backgroundColor:color.replace(')',',0.08)').replace('rgb','rgba').replace('#','').replace(/^([0-9a-f]{6})$/i,(_,h)=>`rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},0.08)`),tension:0.4,pointRadius:0}]},
    options:{responsive:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}},animation:false}
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
    document.getElementById('cf-amount').textContent = fmtDec(balance);
    document.getElementById('leg-inc').textContent = fmt(income);
    document.getElementById('leg-exp').textContent = fmt(expense);
    document.getElementById('cat-total').textContent = fmt(expense);
    const now = new Date();
    document.getElementById('cat-period').textContent = now.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    document.getElementById('hero-sub').textContent = savings_rate >= 20
      ? `Your savings rate is ${savings_rate.toFixed(1)}% — great work! Keep it going with a few quick wins from FinanceAI.`
      : `Your savings rate is ${savings_rate.toFixed(1)}% this month. Let's find ways to improve it together.`;
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
const monthlyExpenses = txnsData.filter(t => {
  const d = new Date(t.date);
  return (
    t.type === "expense" &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
});

const grouped = {};

monthlyExpenses.forEach(t => {
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
            <span class="budget-name">${b.category}</span>
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
      <span class="cat-name"><span class="cat-dot" style="background:${CAT_COLORS[i]}"></span>${e[0]}</span>
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

  const filtered = search
    ? data.filter(t =>
        (t.desc || '').toLowerCase().includes(search) ||
        (t.category || '').toLowerCase().includes(search)
      )
    : data;

  document.getElementById('all-txns').innerHTML = filtered.length
    ? filtered.map(t => fullTxnRow(t)).join('')
    : '<div class="empty-state">No transactions found</div>';
}

function txnRow(t, showDel=false) {
  const inc = t.type==='income';
  const icon = getIcon(t.category);
  const bg = inc ? 'rgba(34,197,94,0.1)' : `rgba(${hashColor(t.category)},0.1)`;
  return `<div class="txn-item">
    <div class="txn-icon" style="background:${bg}">${icon}</div>
    <div class="txn-info"><div class="txn-name">${t.category}</div><div class="txn-meta">${t.category} • ${t.date}</div></div>
    <span class="txn-amount ${inc?'inc':'exp'}">${inc?'+':''}<span class="txn-trend">${inc?'↗':'↗'}</span>${inc?'+':'-'}${fmtDec(t.amount)}</span>
  </div>`;
}

function fullTxnRow(t) {
  const inc = t.type==='income';
  const icon = getIcon(t.category);
  const bg = inc ? 'rgba(34,197,94,0.1)' : `rgba(${hashColor(t.category)},0.1)`;
  return `<div class="full-txn-item">
    <div class="txn-icon" style="background:${bg}">${icon}</div>
    <div class="txn-info"><div class="txn-name">${t.category}</div><div class="txn-meta">${t.category} • ${t.date}</div></div>
    <span class="cat-badge" style="background:var(--bg3);color:var(--text2);padding:3px 8px;border-radius:5px;font-size:11px">${t.category}</span>
    <span class="txn-amount ${inc?'inc':''}" style="${!inc?'color:var(--text)':''}">${inc?'+':'-'}${fmtDec(t.amount)}</span>
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
  if(!amount||!category||!date){alert('Fill all fields');return;}
  await apiFetch('/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,amount,desc:"",category,date})});
  document.getElementById('t-amount').value=''; document.getElementById('t-category').value=''; document.getElementById('t-desc').value='';
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
          <span class="budget-name">${b.category}</span>
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
        <div style="display:flex;align-items:center;gap:10px"><div class="budget-icon" style="width:32px;height:32px;background:var(--bg3);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px">${getIcon(b.category)}</div><span class="bpi-name">${b.category}</span></div>
        <button class="del-btn" onclick="deleteBudget('${b.category}')">Remove</button>
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
  await loadBudgets(); renderBudgets();
}

function renderInsights(income, expense, savings_rate, cats) {
  const top = Object.entries(cats||{}).sort((a,b)=>b[1]-a[1])[0];
  const items = [];
  if (top && income > 0) {
    const pct = Math.round(top[1]/income*100);
    items.push({type:'warn', icon:'⚡', title:`You could save ${fmt(Math.max(0,top[1]*0.15))} this month`, body:`${top[0]} spend is ${pct}% of income. Cutting it by 15% would free up ${fmt(top[1]*0.15)} toward your emergency fund.`, action:'Adjust budget →'});
  }
  if (savings_rate >= 40) {
  title = "Excellent savings rate 🚀";
  body = `You're saving ${savings_rate.toFixed(1)}%. You're far ahead of the ideal 20%!`;
}
else if (savings_rate >= 20) {
  title = "On track 👍";
  body = `You're saving ${savings_rate.toFixed(1)}%. Keep it consistent.`;
}
else {
  title = "Needs improvement ⚠️";
  body = `Your savings rate is ${savings_rate.toFixed(1)}%. Aim for at least 20%.`;
}
  document.getElementById('insights-list').innerHTML = items.length
    ? items.map(i=>`<div class="insight-item"><div class="insight-item-header"><div class="insight-bullet ${i.type}">${i.icon}</div><div><div class="insight-text-title">${i.title}</div><div class="insight-text-body">${i.body}</div>${i.action?`<span class="insight-action">${i.action}</span>`:''}</div></div></div>`).join('')
    : '<div class="empty-state">Add transactions to see insights</div>';
}

function openModal() {
  document.getElementById('modal').classList.add('open');
  document.getElementById('m-date').value = new Date().toISOString().slice(0,10);
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
async function submitModal() {
  const type=document.getElementById('m-type').value, amount=parseFloat(document.getElementById('m-amount').value);
  const category=document.getElementById('m-category').value.trim(), date=document.getElementById('m-date').value;
  if(!amount||!category||!date){alert('Fill all fields');return;}
  await apiFetch('/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,amount,desc:"",category,date})});
  closeModal();
  document.getElementById('m-amount').value=''; document.getElementById('m-category').value=''; document.getElementById('m-desc').value='';
  refreshCurrentPage();
}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))closeModal();});

function goPage(name, el) {
  currentPage = name;

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

  document.getElementById('page-'+name).classList.add('active');
  if(el) el.classList.add('active');

  const titles = {
    dashboard:'Overview',
    transactions:'Transactions',
    budgets:'Budgets',
    accounts:'Accounts',
    'ai-page':'AI Assistant'
  };

  document.getElementById('topbar-title').textContent = titles[name]||name;
}

document.getElementById('search-input').addEventListener('input', ()=>renderAllTxns(txnsData));

async function initApp() {
  await loadTransactions();
  await loadBudgets();
  await loadSummary();
}
async function refreshAll() {
  await Promise.all([loadSummary(), loadTransactions(), loadBudgets()]);
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
  container.addEventListener('scroll', () => {
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
      console.log("Reached bottom (you can load more here)");
    }
  });
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
  } 
  else if (currentPage === 'budgets') {
    loadBudgets();
    renderBudgets();
  } 
  else if (currentPage === 'dashboard') {
    loadSummary();
  }
}
window.onload = async () => {
  setGreeting();

  await loadTransactions();
  await loadBudgets();

  showMonthlyExpenses();
};
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
      <div class="chat-bubble user">${msg}</div>
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
    const res = await fetch("http://localhost:8000/ai/advice", {
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
          ${data.advice || "No response"}
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
