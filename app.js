/* ===================================================================
   云记账 · 多端同步  —  app.js
   纯前端记账应用，离线 localStorage + GitHub Gist 云端同步
   =================================================================== */

'use strict';

/* ----------------------------- 常量与默认值 ----------------------------- */
const LS_KEY = 'cloud-ledger:v1';
const SYNC_KEY = 'cloud-ledger:sync:v1';
const GIST_FILENAME = 'cloud-ledger-data.json';

const EMOJI_PALETTE = [
  '🍜','🚌','🛒','🎮','🏠','💊','📚','📱','✈️','👕','🎁','☕',
  '🐶','🐱','💻','🎬','🏊','🎸','🎨','💡','🔧','💰','💼','📈',
  '🧧','💵','💳','🏦','🎯','📊','📦','🎉','🍔','🚕','🛵','🏥'
];

const DEFAULT_CATEGORIES = [
  { id:'c_food',     name:'餐饮',   emoji:'🍜', type:'expense' },
  { id:'c_transport',name:'交通',   emoji:'🚌', type:'expense' },
  { id:'c_shopping', name:'购物',   emoji:'🛒', type:'expense' },
  { id:'c_fun',      name:'娱乐',   emoji:'🎮', type:'expense' },
  { id:'c_home',     name:'居住',   emoji:'🏠', type:'expense' },
  { id:'c_medical',  name:'医疗',   emoji:'💊', type:'expense' },
  { id:'c_edu',      name:'教育',   emoji:'📚', type:'expense' },
  { id:'c_comm',     name:'通讯',   emoji:'📱', type:'expense' },
  { id:'c_other_e',  name:'其他',   emoji:'💸', type:'expense' },
  { id:'c_salary',   name:'工资',   emoji:'💰', type:'income'  },
  { id:'c_side',     name:'兼职',   emoji:'💼', type:'income'  },
  { id:'c_invest',   name:'投资',   emoji:'📈', type:'income'  },
  { id:'c_gift',     name:'红包',   emoji:'🧧', type:'income'  },
  { id:'c_other_i',  name:'其他',   emoji:'💵', type:'income'  },
];

const DONUT_COLORS = [
  '#0D9488','#F87171','#F59E0B','#8B5CF6','#3B82F6','#EC4899',
  '#14B8A6','#EF4444','#F97316','#A855F7','#6366F1','#22C55E'
];

/* ----------------------------- 状态 ----------------------------- */
let state = {
  transactions: [],
  categories: [],
  settings: { currency: '¥', autoSync: true },
};
let syncCfg = { token: '', gistId: '', lastSyncAt: null };
let ui = { view: 'dashboard', month: null, txFilter: 'all', search: '', editingTxId: null, editingCatId: null, catType: 'expense', pickedEmoji: '🍜', pickedCatId: null, syncBusy: false };

/* ----------------------------- 存储读写 ----------------------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.transactions = parsed.transactions || [];
      state.categories = parsed.categories || [];
      state.settings = Object.assign({ currency:'¥', autoSync:true }, parsed.settings || {});
    } else {
      state.categories = DEFAULT_CATEGORIES.map(c => ({ ...c, builtin:true, createdAt:Date.now(), updatedAt:Date.now() }));
      persist();
    }
    const sraw = localStorage.getItem(SYNC_KEY);
    if (sraw) syncCfg = Object.assign(syncCfg, JSON.parse(sraw));
  } catch (e) { console.error('load err', e); }
  if (!state.categories.length) {
    state.categories = DEFAULT_CATEGORIES.map(c => ({ ...c, builtin:true, createdAt:Date.now(), updatedAt:Date.now() }));
  }
  if (!ui.month) ui.month = ymOf(new Date());
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    transactions: state.transactions,
    categories: state.categories,
    settings: state.settings,
  }));
}
function persistSync() { localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)); }

/* ----------------------------- 工具函数 ----------------------------- */
const uid = () => 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const now = () => Date.now();
function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
function ymOfStr(dateStr) { return dateStr ? dateStr.slice(0,7) : ymOf(new Date()); }
function parseYM(ym) { const [y,m] = ym.split('-').map(Number); return { y, m }; }
function todayStr() { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtMoney(n, withSym) {
  n = Math.round((Number(n)||0)*100)/100;
  const sign = n<0 ? '-' : '';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return (withSym?sign:'') + s;
}
function fmtShort(n) {
  n = Number(n)||0;
  if (Math.abs(n) >= 10000) return (n/10000).toFixed(1) + '万';
  return n.toLocaleString('zh-CN',{maximumFractionDigits:0});
}
function monthLabel(ym) {
  const {y,m} = parseYM(ym);
  return y + '年' + m + '月';
}
function catById(id) { return state.categories.find(c => c.id === id) || { name:'未分类', emoji:'❔', type:'expense' }; }
function catsByType(t) { return state.categories.filter(c => c.type === t); }

/* 本月交易（含删除墓碑过滤） */
function liveTx() { return state.transactions.filter(t => !t.deleted); }
function monthTx(ym) { return liveTx().filter(t => ymOfStr(t.date) === ym); }
function monthIncome(ym) { return monthTx(ym).filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0); }
function monthExpense(ym) { return monthTx(ym).filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0); }

/* ----------------------------- 交易 CRUD ----------------------------- */
function saveTransaction(tx) {
  if (tx.id) {
    const i = state.transactions.findIndex(t => t.id === tx.id);
    if (i >= 0) { tx.updatedAt = now(); state.transactions[i] = tx; }
    else { tx.updatedAt = now(); state.transactions.push(tx); }
  } else {
    tx.id = uid(); tx.createdAt = now(); tx.updatedAt = now(); tx.deleted = false;
    state.transactions.push(tx);
  }
  persist();
}
function deleteTransaction(id) {
  const i = state.transactions.findIndex(t => t.id === id);
  if (i >= 0) { state.transactions[i].deleted = true; state.transactions[i].updatedAt = now(); persist(); }
}

/* ----------------------------- 分类 CRUD ----------------------------- */
function saveCategory(cat) {
  if (cat.id) {
    const i = state.categories.findIndex(c => c.id === cat.id);
    if (i >= 0) { cat.updatedAt = now(); state.categories[i] = cat; }
  } else {
    cat.id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    cat.createdAt = now(); cat.updatedAt = now(); cat.builtin = false;
    state.categories.push(cat);
  }
  persist();
}
function deleteCategory(id) {
  // 内置分类不可删除；有交易关联则保留但隐藏？这里直接移除自定义分类
  const cat = state.categories.find(c => c.id === id);
  if (!cat || cat.builtin) return false;
  const inUse = liveTx().some(t => t.categoryId === id);
  if (inUse) return false;
  state.categories = state.categories.filter(c => c.id !== id);
  persist();
  return true;
}

/* ============================ GitHub Gist 同步 ============================ */
async function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + syncCfg.token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function buildBlob() {
  return JSON.stringify({
    app: 'cloud-ledger',
    version: 1,
    updatedAt: now(),
    transactions: state.transactions,
    categories: state.categories,
    settings: { currency: state.settings.currency },
  }, null, 2);
}

/* 时间戳合并：以 updatedAt 为准，墓碑传播 */
function mergeData(local, remote) {
  const map = new Map();
  const merge = (arr) => {
    for (const x of arr) {
      const cur = map.get(x.id);
      if (!cur || (x.updatedAt||0) >= (cur.updatedAt||0)) map.set(x.id, x);
    }
  };
  merge(local.transactions || []);
  merge(remote.transactions || []);
  // 清理 30 天前的墓碑
  const cutoff = now() - 30*24*3600*1000;
  let transactions = [...map.values()].filter(t => !(t.deleted && (t.updatedAt||0) < cutoff));
  transactions.sort((a,b) => (b.date||'').localeCompare(a.date||''));

  // 分类合并
  const cmap = new Map();
  const cmerge = (arr) => {
    for (const x of arr) {
      const cur = cmap.get(x.id);
      if (!cur || (x.updatedAt||0) >= (cur.updatedAt||0)) cmap.set(x.id, x);
    }
  };
  cmerge(local.categories || []);
  cmerge(remote.categories || []);
  const categories = [...cmap.values()];

  // 设置合并：货币以较新者为准
  const settings = Object.assign({}, local.settings||{}, remote.settings||{});

  return { transactions, categories, settings };
}

async function ghCreateGist() {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: await ghHeaders(),
    body: JSON.stringify({
      description: '云记账 · 多端同步数据（请勿手动编辑）',
      public: false,
      files: { [GIST_FILENAME]: { content: buildBlob() } },
    }),
  });
  if (!res.ok) throw new Error('创建 Gist 失败：' + res.status + (res.status===401?'（Token 无效）':''));
  const data = await res.json();
  return data.id;
}

async function ghFetchGist() {
  const res = await fetch('https://api.github.com/gists/' + syncCfg.gistId, { headers: await ghHeaders() });
  if (!res.ok) throw new Error('读取云端失败：' + res.status + (res.status===404?'（Gist 不存在）':''));
  const data = await res.json();
  const f = data.files && data.files[GIST_FILENAME];
  if (!f) throw new Error('云端数据文件不存在');
  return JSON.parse(f.content);
}

async function ghPushGist() {
  const res = await fetch('https://api.github.com/gists/' + syncCfg.gistId, {
    method: 'PATCH',
    headers: await ghHeaders(),
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content: buildBlob() } } }),
  });
  if (!res.ok) throw new Error('写入云端失败：' + res.status);
  return (await res.json()).updated_at;
}

let syncTimer = null;
async function doSync(silent) {
  if (ui.syncBusy) return;
  if (!syncCfg.token) { setSyncStatus('off','未配置'); return; }
  ui.syncBusy = true; setSyncStatus('busy','同步中…');
  try {
    if (!syncCfg.gistId) { syncCfg.gistId = await ghCreateGist(); persistSync(); }
    const remote = await ghFetchGist();
    const merged = mergeData({ transactions:state.transactions, categories:state.categories, settings:state.settings }, remote);
    // 先以本地+远端合并结果推送（保证两端一致）
    state.transactions = merged.transactions;
    state.categories = merged.categories;
    state.settings = Object.assign(state.settings, merged.settings);
    persist();
    await ghPushGist();
    syncCfg.lastSyncAt = now(); persistSync();
    ui.syncBusy = false; setSyncStatus('on','已同步');
    if (!silent) toast('同步成功', 'ok');
    render();
  } catch (e) {
    ui.syncBusy = false;
    const msg = e.message || '同步失败';
    setSyncStatus('err', msg.length>14?msg.slice(0,14):msg);
    if (!silent) toast(msg, 'err');
    console.error(e);
  }
}
function scheduleSync() {
  if (!state.settings.autoSync || !syncCfg.token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync(true), 1500);
}
function setSyncStatus(kind, label) {
  const dot = document.getElementById('syncDot');
  const lab = document.getElementById('syncLabel');
  const tm = document.getElementById('syncTime');
  dot.className = 'sync-dot ' + kind;
  lab.textContent = label;
  if (syncCfg.lastSyncAt) {
    const d = new Date(syncCfg.lastSyncAt);
    tm.textContent = '上次同步 ' + String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  } else { tm.textContent = ''; }
  const qs = document.getElementById('quickSync');
  if (qs) qs.classList.toggle('spin', kind==='busy');
}

/* ============================ 渲染 ============================ */
const $ = (s) => document.querySelector(s);
const el = (h) => { const t=document.createElement('template'); t.innerHTML=h.trim(); return t.content.firstChild; };

function render() {
  const v = ui.view;
  const titles = { dashboard:'概览', transactions:'明细', reports:'报表', categories:'分类', settings:'设置' };
  $('#topbarTitle').textContent = titles[v] || '云记账';
  document.querySelectorAll('.nav-item, .bottom-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  // 月份选择器仅概览/明细/报表显示
  $('#monthPicker').style.display = (v==='dashboard'||v==='transactions'||v==='reports') ? 'flex' : 'none';
  $('#monthLabel').textContent = monthLabel(ui.month);
  const c = $('#view');
  c.innerHTML = '';
  if (v==='dashboard') renderDashboard(c);
  else if (v==='transactions') renderTransactions(c);
  else if (v==='reports') renderReports(c);
  else if (v==='categories') renderCategories(c);
  else if (v==='settings') renderSettings(c);
  // 同步状态刷新
  if (syncCfg.token) setSyncStatus('on','已连接'); else setSyncStatus('off','未配置');
}

/* ---- 概览 ---- */
function renderDashboard(c) {
  const ym = ui.month;
  const inc = monthIncome(ym), exp = monthExpense(ym), bal = inc - exp;
  const list = monthTx(ym).sort((a,b)=> (b.date+b.createdAt).localeCompare(a.date+a.createdAt)).slice(0,8);

  const hero = el(`<section class="balance-card">
    <div class="balance-label">本月结余 ${monthLabel(ym)}</div>
    <div class="balance-amount">${state.settings.currency}${fmtMoney(Math.abs(bal)).split('.')[0]}<span class="cents">.${fmtMoney(Math.abs(bal)).split('.')[1]}</span></div>
    <div class="balance-split">
      <div class="balance-col"><div class="lab">收入</div><div class="val inc">+${state.settings.currency}${fmtMoney(inc)}</div></div>
      <div class="balance-col"><div class="lab">支出</div><div class="val exp">-${state.settings.currency}${fmtMoney(exp)}</div></div>
    </div>
  </section>`);
  c.appendChild(hero);

  // 统计卡
  const prevYM = prevMonth(ym);
  const prevInc = monthIncome(prevYM), prevExp = monthExpense(prevYM);
  const stat = el(`<section class="stat-row">
    <div class="stat-card"><div class="lab">收入</div><div class="val inc">${state.settings.currency}${fmtMoney(inc)}</div><div class="delta">上月 ${state.settings.currency}${fmtShort(prevInc)}</div></div>
    <div class="stat-card"><div class="lab">支出</div><div class="val exp">${state.settings.currency}${fmtMoney(exp)}</div><div class="delta">上月 ${state.settings.currency}${fmtShort(prevExp)}</div></div>
    <div class="stat-card"><div class="lab">结余</div><div class="val">${state.settings.currency}${fmtMoney(bal)}</div><div class="delta">本月共 ${monthTx(ym).length} 笔</div></div>
  </section>`);
  c.appendChild(stat);

  // 主体：周柱状图 + 最近明细
  const grid = el(`<section class="dash-grid"></section>`);
  const chartCard = el(`<div class="card"><div class="chart-wrap"><div class="section-title" style="margin-bottom:12px">本周支出</div><div id="weekChart"></div></div></div>`);
  grid.appendChild(chartCard);
  const listCard = el(`<div class="card"><div class="tx-list" style="padding:20px 24px 24px"><div class="tx-list-head"><span class="section-title">最近明细</span><button class="chip" id="seeAll">查看全部 →</button></div><div id="recentList"></div></div></div>`);
  grid.appendChild(listCard);
  c.appendChild(grid);

  drawWeekChart($('#weekChart'));
  const rl = $('#recentList');
  if (!list.length) {
    rl.appendChild(el(`<div class="empty"><div class="empty-ico">📒</div><p>本月还没有记录，点击右下角 + 记一笔</p></div>`));
  } else {
    list.forEach(t => rl.appendChild(txRow(t)));
  }
  $('#seeAll').onclick = () => switchView('transactions');
}

/* 周柱状图 */
function drawWeekChart(container) {
  if (!container) return;
  // 本周一~周日
  const today = new Date();
  const day = today.getDay() || 7; // 周日=0 ->7
  const monday = new Date(today); monday.setDate(today.getDate() - day + 1);
  const days = [];
  for (let i=0;i<7;i++) {
    const d = new Date(monday); d.setDate(monday.getDate()+i);
    days.push({ date: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'), label:'日一二三四五六'[i] });
  }
  const totals = days.map(d => monthTx(ui.month).filter(t=>t.type==='expense'&&t.date===d.date).reduce((s,t)=>s+t.amount,0));
  const max = Math.max(...totals, 1);
  const weekTotal = totals.reduce((s,v)=>s+v,0);
  if (weekTotal === 0) {
    container.innerHTML = `<div class="empty" style="padding:30px 0"><div class="empty-ico">📊</div><p style="font-size:13px">本周暂无支出</p></div>`;
    return;
  }
  const w = 320, h = 150, pad = 8, bw = (w - pad*8)/7;
  let bars = '';
  days.forEach((d,i) => {
    const bh = (totals[i]/max) * (h-30);
    const y = h - 24 - bh;
    const isToday = d.date === todayStr();
    bars += `<rect x="${pad + i*(bw+pad)}" y="${y}" width="${bw}" height="${Math.max(bh,2)}" rx="4" fill="${isToday?'#0D9488':'#5EEAD4'}" opacity="${totals[i]?1:0.4}"/>`;
    bars += `<text x="${pad + i*(bw+pad) + bw/2}" y="${h-8}" text-anchor="middle" font-size="10" fill="#94A3B8">${d.label}</text>`;
  });
  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

/* ---- 明细 ---- */
function renderTransactions(c) {
  const wrap = el(`<div></div>`);
  // 筛选
  const filters = el(`<div class="filters">
    <button class="chip ${ui.txFilter==='all'?'active':''}" data-f="all">全部</button>
    <button class="chip ${ui.txFilter==='expense'?'active':''}" data-f="expense">支出</button>
    <button class="chip ${ui.txFilter==='income'?'active':''}" data-f="income">收入</button>
    <div class="search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg><input type="text" id="searchInput" placeholder="搜索备注/分类" value="${ui.search}"/></div>
  </div>`);
  wrap.appendChild(filters);

  let list = monthTx(ui.month).sort((a,b)=> (b.date+b.createdAt).localeCompare(a.date+a.createdAt));
  if (ui.txFilter !== 'all') list = list.filter(t => t.type === ui.txFilter);
  if (ui.search) {
    const q = ui.search.toLowerCase();
    list = list.filter(t => { const cat = catById(t.categoryId); return (t.note||'').toLowerCase().includes(q) || cat.name.toLowerCase().includes(q); });
  }
  // 按日期分组
  const groups = {};
  list.forEach(t => { (groups[t.date] = groups[t.date]||[]).push(t); });
  const dates = Object.keys(groups).sort((a,b)=> b.localeCompare(a));

  const listEl = el(`<div class="card" style="padding:8px 12px;margin-top:16px"></div>`);
  if (!list.length) {
    listEl.appendChild(el(`<div class="empty"><div class="empty-ico">🔍</div><p>没有符合条件的记录</p></div>`));
  } else {
    dates.forEach(d => {
      const dayExp = groups[d].filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
      const dayInc = groups[d].filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
      listEl.appendChild(el(`<div class="tx-group-label">${d.slice(5)} · 支${state.settings.currency}${fmtShort(dayExp)} 收${state.settings.currency}${fmtShort(dayInc)}</div>`));
      groups[d].forEach(t => listEl.appendChild(txRow(t)));
    });
  }
  wrap.appendChild(listEl);
  c.appendChild(wrap);

  // 绑定筛选
  wrap.querySelectorAll('.chip[data-f]').forEach(b => b.onclick = () => { ui.txFilter = b.dataset.f; render(); });
  const si = $('#searchInput');
  if (si) si.oninput = () => { ui.search = si.value; render(); $('#searchInput').focus(); };
}

function txRow(t) {
  const cat = catById(t.categoryId);
  const exp = t.type === 'expense';
  const sym = exp ? '-' : '+';
  const date = t.date ? t.date.slice(5) : '';
  const meta = [date, t.note].filter(Boolean).join(' · ') || date;
  const row = el(`<div class="tx-row" data-id="${t.id}">
    <div class="tx-icon">${cat.emoji||'❔'}</div>
    <div class="tx-info"><div class="tx-desc">${t.note || cat.name}</div><div class="tx-meta">${meta}</div></div>
    <div class="tx-amount ${exp?'exp':'inc'}"><span class="sym">${sym}</span>${state.settings.currency}${fmtMoney(t.amount)}</div>
  </div>`);
  row.onclick = () => openTxModal(t.id);
  return row;
}

/* ---- 报表 ---- */
function renderReports(c) {
  const ym = ui.month;
  const exp = monthExpense(ym), inc = monthIncome(ym);
  const c2 = el(`<div class="report-grid"></div>`);
  // 分类占比
  const byCat = {};
  monthTx(ym).filter(t=>t.type==='expense').forEach(t => { byCat[t.categoryId] = (byCat[t.categoryId]||0) + t.amount; });
  const sorted = Object.entries(byCat).sort((a,b)=> b[1]-a[1]);
  const total = sorted.reduce((s,[,v])=>s+v,0);

  const donutCard = el(`<div class="card report-card"><div class="section-title" style="margin-bottom:16px">支出分类 · ${monthLabel(ym)}</div><div class="donut-wrap"><div id="donut"></div><div class="donut-legend" id="donutLegend"></div></div></div>`);
  c2.appendChild(donutCard);

  const trendCard = el(`<div class="card report-card"><div class="section-title" style="margin-bottom:16px">近 6 月趋势</div><div id="trend"></div></div>`);
  c2.appendChild(trendCard);

  c.appendChild(c2);
  drawDonut($('#donut'), $('#donutLegend'), sorted, total, exp);
  drawTrend($('#trend'));
}

function drawDonut(container, legend, sorted, total, expTotal) {
  if (!container) return;
  const r = 70, cx = 100, cy = 100, sw = 26, C = 2*Math.PI*r;
  let offset = 0;
  let segs = '';
  if (total === 0) {
    segs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E2E8F0" stroke-width="${sw}"/>`;
  } else {
    sorted.forEach(([cid, val], i) => {
      const frac = val/total;
      const len = frac * C;
      const cat = catById(cid);
      const color = DONUT_COLORS[i % DONUT_COLORS.length];
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
      offset += len;
    });
  }
  container.innerHTML = `<svg class="donut-svg" viewBox="0 0 200 200">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F1F5F9" stroke-width="${sw}"/>
    ${segs}
    <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="12" fill="#94A3B8">总支出</text>
    <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#0F172A">${state.settings.currency}${fmtMoney(expTotal)}</text>
  </svg>`;
  let lh = '';
  if (!sorted.length) {
    lh = `<div class="empty" style="padding:16px 0"><p>本月暂无支出</p></div>`;
  } else {
    sorted.forEach(([cid, val], i) => {
      const cat = catById(cid);
      const color = DONUT_COLORS[i % DONUT_COLORS.length];
      const pct = total ? (val/total*100).toFixed(0) : 0;
      lh += `<div class="legend-row"><span class="legend-dot" style="background:${color}"></span><span class="legend-name">${cat.emoji} ${cat.name}</span><span class="legend-val">${state.settings.currency}${fmtMoney(val)} · ${pct}%</span></div>`;
    });
  }
  legend.innerHTML = lh;
}

function drawTrend(container) {
  if (!container) return;
  const months = [];
  for (let i=5;i>=0;i--) { months.push(prevMonth(ui.month, i)); }
  const incs = months.map(m => monthIncome(m));
  const exps = months.map(m => monthExpense(m));
  const maxV = Math.max(...incs, ...exps, 1) * 1.1;
  const w = 600, h = 180, padL=40, padR=16, padT=16, padB=28;
  const stepX = (w - padL - padR) / (months.length - 1 || 1);
  const x = i => padL + i*stepX;
  const y = v => padT + (1 - v/maxV) * (h - padT - padB);
  const path = (arr) => arr.map((v,i)=> (i?'L':'M') + x(i) + ' ' + y(v)).join(' ');
  const areaPath = (arr) => path(arr) + ` L ${x(arr.length-1)} ${h-padB} L ${x(0)} ${h-padB} Z`;
  let grid = '';
  for (let i=0;i<=4;i++){ const gy = padT + i*(h-padT-padB)/4; grid += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#EEF2F6"/>`; }
  let xlab = '';
  months.forEach((ymStr,i) => { const p = parseYM(ymStr); xlab += `<text x="${x(i)}" y="${h-8}" text-anchor="middle" font-size="10" fill="#94A3B8">${p.m}月</text>`; });
  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <path d="${areaPath(incs)}" fill="rgba(13,148,136,.12)"/>
    <path d="${path(incs)}" fill="none" stroke="#0D9488" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${path(exps)}" fill="none" stroke="#F87171" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="0"/>
    ${xlab}
    <g transform="translate(${w-padR-90},${padT})"><rect width="9" height="9" rx="2" fill="#0D9488"/><text x="13" y="8" font-size="10" fill="#64748B">收入</text><rect x="38" width="9" height="9" rx="2" fill="#F87171"/><text x="51" y="8" font-size="10" fill="#64748B">支出</text></g>
  </svg>`;
}

/* ---- 分类 ---- */
function renderCategories(c) {
  const groups = [
    { type:'expense', title:'支出分类' },
    { type:'income', title:'收入分类' },
  ];
  groups.forEach(g => {
    const list = state.categories.filter(x => x.type === g.type);
    const sec = el(`<section style="margin-bottom:20px"><div class="section-title" style="margin-bottom:12px">${g.title}</div><div class="cat-list"></div></section>`);
    const grid = sec.querySelector('.cat-list');
    list.forEach(cat => {
      const cnt = liveTx().filter(t => t.categoryId === cat.id).length;
      const tile = el(`<div class="cat-tile" data-id="${cat.id}"><div class="emoji">${cat.emoji}</div><div class="name">${cat.name}</div><div class="cnt">${cnt} 笔</div><div class="tag ${g.type}">${cat.builtin?'内置':'自定义'}</div></div>`);
      tile.onclick = () => openCatModal(cat.id);
      grid.appendChild(tile);
    });
    const add = el(`<div class="cat-tile add-tile" data-type="${g.type}"><div><div class="plus">＋</div><div class="label">添加分类</div></div></div>`);
    add.onclick = () => openCatModal(null, g.type);
    grid.appendChild(add);
    c.appendChild(sec);
  });
}

/* ---- 设置 ---- */
function renderSettings(c) {
  const configured = !!syncCfg.token;
  const wrap = el(`<div class="settings"></div>`);
  wrap.innerHTML = `
    <div class="card set-card">
      <h3>云端同步</h3>
      <p class="help">通过 <b>GitHub Gist</b> 在电脑与手机间同步数据，免费、无需服务器。你的数据存放在你自己的 GitHub 私密 Gist 中。</p>
      <div class="set-field">
        <label>GitHub Token（Classic，勾选 gist 权限）</label>
        <input class="input" id="setToken" type="password" placeholder="ghp_..." value="${escapeAttr(syncCfg.token)}" />
      </div>
      <div class="set-field">
        <label>Gist ID（留空将自动创建）</label>
        <input class="input" id="setGistId" type="text" placeholder="自动创建" value="${escapeAttr(syncCfg.gistId)}" />
      </div>
      <div class="set-row">
        <div class="k"><div class="name">自动同步</div><div class="desc">每次记账后自动上传</div></div>
        <label class="switch"><input type="checkbox" id="setAutoSync" ${state.settings.autoSync?'checked':''}/><span class="slider"></span></label>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" id="btnSaveSync">保存并测试</button>
        <button class="btn btn-ghost" id="btnSyncNow">立即同步</button>
        <button class="btn btn-ghost" id="btnDisconnect" ${configured?'':'disabled'}>断开连接</button>
      </div>
      <div class="help" style="margin-top:14px">
        <b>如何获取 Token：</b><br/>
        打开 GitHub → 右上头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾选 <code>gist</code> 权限，生成后粘贴到上方。<br/>
        Token 仅保存在本设备本地，不会上传。<br/>
        <b>多端使用：</b>在手机上打开本应用，填入同样的 Token 与 Gist ID 即可同步。
      </div>
    </div>
    <div class="card set-card">
      <h3>偏好设置</h3>
      <div class="set-field">
        <label>货币符号</label>
        <input class="input" id="setCurrency" type="text" maxlength="3" value="${escapeAttr(state.settings.currency)}" style="max-width:120px"/>
      </div>
      <button class="btn btn-primary" id="btnSavePref" style="margin-top:8px">保存偏好</button>
    </div>
    <div class="card set-card">
      <h3>数据管理</h3>
      <div class="set-row">
        <div class="k"><div class="name">导出数据 (JSON)</div><div class="desc">备份到本地文件</div></div>
        <button class="btn btn-ghost" id="btnExport">导出</button>
      </div>
      <div class="set-row">
        <div class="k"><div class="name">导入数据 (JSON)</div><div class="desc">从备份恢复（会合并）</div></div>
        <button class="btn btn-ghost" id="btnImport">导入</button>
        <input type="file" id="importFile" accept="application/json" style="display:none"/>
      </div>
      <div class="set-row">
        <div class="k"><div class="name">清空本地数据</div><div class="desc">删除本设备所有记录（不影响云端）</div></div>
        <button class="btn btn-ghost" id="btnClear">清空</button>
      </div>
    </div>`;
  c.appendChild(wrap);

  $('#btnSaveSync').onclick = onSaveSync;
  $('#btnSyncNow').onclick = () => doSync(false);
  $('#btnDisconnect').onclick = onDisconnect;
  $('#btnSavePref').onclick = onSavePref;
  $('#btnExport').onclick = onExport;
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = onImport;
  $('#btnClear').onclick = onClear;
}

function escapeAttr(s){ return String(s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

/* ============================ 设置处理 ============================ */
async function onSaveSync() {
  const token = $('#setToken').value.trim();
  const gistId = $('#setGistId').value.trim();
  if (!token) { toast('请填写 Token','err'); return; }
  syncCfg.token = token;
  syncCfg.gistId = gistId;
  persistSync();
  toast('已保存，正在连接…');
  await doSync(false);
  render();
}
function onDisconnect() {
  if (!confirm('确定断开云端连接？本地数据保留，但不再同步。')) return;
  syncCfg.token = ''; syncCfg.gistId = ''; syncCfg.lastSyncAt = null;
  persistSync();
  setSyncStatus('off','未配置');
  toast('已断开连接');
  render();
}
function onSavePref() {
  state.settings.currency = $('#setCurrency').value.trim() || '¥';
  state.settings.autoSync = $('#setAutoSync').checked;
  persist();
  if (syncCfg.token) scheduleSync();
  toast('偏好已保存','ok');
  render();
}
function onExport() {
  const blob = new Blob([buildBlob()], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cloud-ledger-backup-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出','ok');
}
function onImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      const merged = mergeData({ transactions:state.transactions, categories:state.categories, settings:state.settings }, data);
      state.transactions = merged.transactions; state.categories = merged.categories;
      state.settings = Object.assign(state.settings, merged.settings);
      persist();
      toast('导入成功','ok');
      render();
    } catch(err) { toast('导入失败：文件格式错误','err'); }
  };
  r.readAsText(file);
}
function onClear() {
  if (!confirm('确定清空本设备所有记录？此操作不可撤销（云端数据不受影响）。')) return;
  state.transactions = [];
  persist();
  toast('已清空本地数据');
  render();
}

/* ============================ 交易弹窗 ============================ */
function openTxModal(id) {
  ui.editingTxId = id || null;
  const m = $('#txModal');
  $('#txErr').textContent = '';
  const t = id ? state.transactions.find(x=>x.id===id) : null;
  const type = t ? t.type : 'expense';
  $('#txModalTitle').textContent = t ? '编辑记录' : '记一笔';
  $('#amountCurrency').textContent = state.settings.currency;
  $('#amountInput').value = t ? String(t.amount) : '';
  $('#dateInput').value = t ? t.date : todayStr();
  $('#noteInput').value = t ? (t.note||'') : '';
  $('#txDelete').style.display = t ? 'block' : 'none';
  // 类型切换
  $('#typeSwitch').querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type===type));
  renderCatGrid(type, t ? t.categoryId : null);
  m.classList.add('open');
  setTimeout(() => $('#amountInput').focus(), 120);
}
function renderCatGrid(type, selectedId) {
  const grid = $('#catGrid'); grid.innerHTML = '';
  const list = catsByType(type);
  let sel = selectedId || (list[0] && list[0].id);
  list.forEach(cat => {
    const b = el(`<button class="cat-pick ${cat.id===sel?'active':''}" data-id="${cat.id}"><span class="e">${cat.emoji}</span><span class="n">${cat.name}</span></button>`);
    b.onclick = () => { ui.pickedCatId = cat.id; grid.querySelectorAll('.cat-pick').forEach(x=>x.classList.remove('active')); b.classList.add('active'); };
    grid.appendChild(b);
  });
  ui.pickedCatId = sel;
}
function closeTxModal() { $('#txModal').classList.remove('open'); }
function onTxSave() {
  const type = $('#typeSwitch').querySelector('.type-btn.active').dataset.type;
  const amount = parseFloat($('#amountInput').value);
  const date = $('#dateInput').value || todayStr();
  const note = $('#noteInput').value.trim();
  const categoryId = ui.pickedCatId;
  if (!amount || amount <= 0 || isNaN(amount)) { $('#txErr').textContent = '请输入有效金额'; return; }
  if (!categoryId) { $('#txErr').textContent = '请选择分类'; return; }
  const existing = ui.editingTxId ? state.transactions.find(x=>x.id===ui.editingTxId) : null;
  saveTransaction({ id: ui.editingTxId || undefined, type, amount, categoryId, date, note, deleted:false });
  closeTxModal();
  toast('已保存','ok');
  render();
  scheduleSync();
}

/* ============================ 分类弹窗 ============================ */
function openCatModal(id, type) {
  const m = $('#catModal');
  $('#catErr').textContent = '';
  const cat = id ? state.categories.find(c=>c.id===id) : null;
  ui.editingCatId = id || null;
  ui.catType = cat ? cat.type : (type || 'expense');
  ui.pickedEmoji = cat ? cat.emoji : '🍜';
  $('#catModalTitle').textContent = cat ? (cat.builtin?'查看分类':'编辑分类') : '新建分类';
  $('#catNameInput').value = cat ? cat.name : '';
  $('#catTypeSwitch').querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type===ui.catType));
  renderEmojiGrid();
  m.classList.add('open');
  if (!cat || cat.builtin) {
    // 内置分类仅查看，禁用保存
    $('#catNameInput').disabled = cat && cat.builtin;
  } else {
    $('#catNameInput').disabled = false;
  }
}
function renderEmojiGrid() {
  const g = $('#emojiGrid'); g.innerHTML = '';
  EMOJI_PALETTE.forEach(e => {
    const b = el(`<button class="emoji-pick ${e===ui.pickedEmoji?'active':''}">${e}</button>`);
    b.onclick = () => { ui.pickedEmoji = e; g.querySelectorAll('.emoji-pick').forEach(x=>x.classList.remove('active')); b.classList.add('active'); };
    g.appendChild(b);
  });
}
function closeCatModal() { $('#catModal').classList.remove('open'); }
function onCatSave() {
  const cat = ui.editingCatId ? state.categories.find(c=>c.id===ui.editingCatId) : null;
  if (cat && cat.builtin) { closeCatModal(); return; }
  const type = ui.catType;
  const name = $('#catNameInput').value.trim();
  const emoji = ui.pickedEmoji;
  if (!name) { $('#catErr').textContent = '请输入分类名称'; return; }
  saveCategory({ id: ui.editingCatId || undefined, type, name, emoji });
  closeCatModal();
  toast('已保存','ok');
  render();
}

/* ============================ 导航 ============================ */
function switchView(v) {
  ui.view = v;
  closeSidebar();
  render();
}
function prevMonth(ym, n) { n = (n == null ? 1 : n); const {y,m}=parseYM(ym); let d=new Date(y, m-1, 1); d.setMonth(d.getMonth()-n); return ymOf(d); }
function nextMonth(ym) { const {y,m}=parseYM(ym); let d=new Date(y, m-1, 1); d.setMonth(d.getMonth()+1); return ymOf(d); }
function openSidebar() { $('#sidebar').classList.add('open'); let s=$('#appScrim'); if(!s){ s=document.createElement('div'); s.id='appScrim'; s.className='sidebar-scrim'; document.body.appendChild(s); s.onclick=closeSidebar; } s.classList.add('show'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); const s=$('#appScrim'); if(s) s.classList.remove('show'); }

/* ============================ Toast ============================ */
let toastTimer = null;
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' '+kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className='toast', 2200);
}

/* ============================ 事件绑定 ============================ */
function bindEvents() {
  // 导航
  document.querySelectorAll('.nav-item, .bottom-item[data-view]').forEach(b => {
    b.onclick = () => switchView(b.dataset.view);
  });
  $('#fab').onclick = () => openTxModal(null);
  $('#bottomAdd').onclick = () => openTxModal(null);
  $('#menuToggle').onclick = openSidebar;
  // 月份
  $('#prevMonth').onclick = () => { ui.month = prevMonth(ui.month); render(); };
  $('#nextMonth').onclick = () => { ui.month = nextMonth(ui.month); render(); };
  // 快速同步
  $('#quickSync').onclick = () => doSync(false);
  // 交易弹窗
  $('#txClose').onclick = closeTxModal;
  $('#txSave').onclick = onTxSave;
  $('#txDelete').onclick = () => { if (ui.editingTxId && confirm('删除此记录？')) { deleteTransaction(ui.editingTxId); closeTxModal(); toast('已删除'); render(); scheduleSync(); } };
  $('#txModal').onclick = (e) => { if (e.target.id==='txModal') closeTxModal(); };
  $('#typeSwitch').querySelectorAll('.type-btn').forEach(b => {
    b.onclick = () => { $('#typeSwitch').querySelectorAll('.type-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderCatGrid(b.dataset.type, ui.pickedCatId); };
  });
  // 分类弹窗
  $('#catClose').onclick = closeCatModal;
  $('#catSave').onclick = onCatSave;
  $('#catModal').onclick = (e) => { if (e.target.id==='catModal') closeCatModal(); };
  $('#catTypeSwitch').querySelectorAll('.type-btn').forEach(b => {
    b.onclick = () => { $('#catTypeSwitch').querySelectorAll('.type-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); ui.catType = b.dataset.type; };
  });
  // 金额输入：只允许数字和小数点
  $('#amountInput').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^\d.]/g,'').replace(/(\..*)\./g,'$1'); });
  // 键盘 ESC 关闭
  document.addEventListener('keydown', (e) => { if (e.key==='Escape') { closeTxModal(); closeCatModal(); closeSidebar(); } });
}

/* ============================ 启动 ============================ */
function init() {
  loadState();
  bindEvents();
  render();
  // 启动时若有配置则静默同步
  if (syncCfg.token) doSync(true);
}
document.addEventListener('DOMContentLoaded', init);
