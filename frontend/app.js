/**
 * 新闻速览前端
 * 
 * 后端 API 约定（Cloudflare Worker）：
 * 
 *   GET /api/latest
 *     返回最近一周的总结数据，格式：
 *     {
 *       "week_start": "2026-05-25",
 *       "week_end":   "2026-05-31",
 *       "categories": [
 *         {
 *           "category": "tech",          // 英文标识
 *           "label":    "科技",           // 中文名称
 *           "icon":     "💻",             // emoji 图标
 *           "items": [
 *             {
 *               "title":   "...",        // 一句话标题
 *               "summary": "...",        // 2-3 句 AI 总结
 *               "sources": [
 *                 { "name": "TechCrunch", "url": "https://..." }
 *               ]
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *
 *   GET /api/weekly?week=YYYY-MM-DD
 *     同上，返回指定周的总结。
 *
 *   错误时返回 { "error": "描述信息" }，HTTP 状态码非 2xx。
 */

// ── 配置 ──────────────────────────────────────────────
// 部署时将此处替换为你的 Cloudflare Worker 地址
const API_BASE = 'https://news-summary.gene-ives-herry.workers.dev';

// ── 状态 ──────────────────────────────────────────────
let currentData = null;
let currentView = 'all';

// ── DOM 引用 ──────────────────────────────────────────
const $content = document.getElementById('content');
const $categoriesGrid = document.getElementById('categoriesGrid');
const $stateLoading = document.getElementById('stateLoading');
const $stateError = document.getElementById('stateError');
const $stateEmpty = document.getElementById('stateEmpty');
const $errorMessage = document.getElementById('errorMessage');
const $weekRange = document.getElementById('weekRange');
const $currentWeekLabel = document.getElementById('currentWeekLabel');
const $prevWeek = document.getElementById('prevWeek');
const $nextWeek = document.getElementById('nextWeek');

// ── 工具函数 ──────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return `${s.getMonth() + 1}月${s.getDate()}日 - ${e.getMonth() + 1}月${e.getDate()}日`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── 加载数据 ──────────────────────────────────────────
async function loadData(week) {
  showState('loading');

  try {
    const url = week
      ? `${API_BASE}/api/weekly?week=${week}`
      : `${API_BASE}/api/latest`;

    const data = await fetchJSON(url);

    if (!data || !data.categories || data.categories.length === 0) {
      showState('empty');
      return;
    }

    currentData = data;
    renderAll(data);
    showState('data');
  } catch (err) {
    $errorMessage.textContent = err.message || '无法获取数据，请检查网络连接。';
    showState('error');
  }
}

// ── 渲染 ──────────────────────────────────────────────
function renderAll(data) {
  $weekRange.textContent = formatWeekRange(data.week_start, data.week_end);
  $currentWeekLabel.textContent = formatWeekRange(data.week_start, data.week_end);

  updateNavButtons(data.week_start);

  const filtered = currentView === 'all'
    ? data.categories
    : data.categories.filter(c => c.category === currentView);

  $categoriesGrid.innerHTML = filtered.map(renderCategory).join('');
}

function renderCategory(cat) {
  return `
    <section class="category-card">
      <div class="category-header">
        <span class="category-icon">${cat.icon || '📌'}</span>
        <span class="category-name">${cat.label || cat.category}</span>
        <span class="category-count">${cat.items.length} 条</span>
      </div>
      <div class="category-items">
        ${cat.items.map(renderItem).join('')}
      </div>
    </section>
  `;
}

function renderItem(item) {
  const sources = (item.sources || [])
    .map(s => `<a class="source-tag" href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`)
    .join('');

  return `
    <div class="news-item">
      <div class="news-title">${escapeHTML(item.title)}</div>
      <div class="news-summary">${escapeHTML(item.summary)}</div>
      <div class="news-sources">${sources}</div>
    </div>
  `;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── 状态切换 ──────────────────────────────────────────
function showState(state) {
  $stateLoading.classList.toggle('hidden', state !== 'loading');
  $stateError.classList.toggle('hidden', state !== 'error');
  $stateEmpty.classList.toggle('hidden', state !== 'empty');
  $categoriesGrid.classList.toggle('hidden', state !== 'data');
}

// ── 周导航 ────────────────────────────────────────────
function updateNavButtons(weekStart) {
  const today = new Date();
  const currentMonday = new Date(today);
  currentMonday.setDate(today.getDate() - today.getDay() + 1);
  const thisMondayStr = currentMonday.toISOString().slice(0, 10);

  $nextWeek.disabled = weekStart >= thisMondayStr;

  const earliest = new Date('2025-01-01').toISOString().slice(0, 10);
  $prevWeek.disabled = weekStart <= earliest;
}

function goToPrevWeek() {
  if (!currentData) return;
  const d = new Date(currentData.week_start + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  loadData(d.toISOString().slice(0, 10));
}

function goToNextWeek() {
  if (!currentData) return;
  const d = new Date(currentData.week_start + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  loadData(d.toISOString().slice(0, 10));
}

// ── 视图切换 ──────────────────────────────────────────
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.btn-toggle').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  if (currentData) renderAll(currentData);
}

// ── 事件绑定 ──────────────────────────────────────────
$prevWeek.addEventListener('click', goToPrevWeek);
$nextWeek.addEventListener('click', goToNextWeek);

document.querySelector('.view-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-toggle');
  if (btn) switchView(btn.dataset.view);
});

// ── 启动 ──────────────────────────────────────────────
loadData();
