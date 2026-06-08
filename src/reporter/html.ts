import fs from 'fs';
import type { ReportData } from './types';

export function generateHtmlReport(data: ReportData): string {
    const { meta, summary, issues } = data;
    const jsonData = JSON.stringify(data);
    const categories = Object.keys(summary.byCategory).sort();
    const maxCat = Math.max(...Object.values(summary.byCategory), 1);

    const categoryBars = categories.map(cat => {
        const count = summary.byCategory[cat] ?? 0;
        const pct = Math.round((count / maxCat) * 100);
        return `
        <div class="cat-row">
          <span class="cat-label">${cat}</span>
          <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div>
          <span class="cat-count">${count}</span>
        </div>`;
    }).join('');

    const severityCheckboxes = ['high', 'medium', 'low'].map(s => `
        <label class="filter-check">
          <input type="checkbox" checked data-severity="${s}" onchange="applyFilters()">
          <span class="sev-${s}">${s.toUpperCase()}</span>
        </label>`).join('');

    const categoryCheckboxes = categories.map(cat => `
        <label class="filter-check">
          <input type="checkbox" checked data-category="${cat}" onchange="applyFilters()">
          ${cat}
        </label>`).join('');

    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>candl-parser · ${meta.project}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  .header { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .meta { color: #64748b; font-size: 13px; margin-left: auto; }
  .dashboard { padding: 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; max-width: 1200px; margin: 0 auto; }
  .stat-card { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-num { font-size: 32px; font-weight: 700; }
  .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; margin-top: 4px; }
  .stat-high .stat-num { color: #f87171; }
  .stat-medium .stat-num { color: #fbbf24; }
  .stat-low .stat-num { color: #94a3b8; }
  .cats { grid-column: span 4; background: #1e293b; border-radius: 8px; padding: 16px; }
  .cats h3 { font-size: 12px; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
  .cat-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .cat-label { width: 110px; font-size: 13px; color: #94a3b8; }
  .cat-bar-wrap { flex: 1; background: #334155; border-radius: 3px; height: 8px; }
  .cat-bar { background: #3b82f6; border-radius: 3px; height: 8px; min-width: 2px; }
  .cat-count { width: 30px; text-align: right; font-size: 13px; color: #64748b; }
  .main { display: flex; max-width: 1200px; margin: 0 auto; padding: 0 24px 24px; gap: 16px; }
  #sidebar { width: 200px; flex-shrink: 0; background: #1e293b; border-radius: 8px; padding: 16px; position: sticky; top: 65px; height: fit-content; }
  #sidebar h3 { font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 8px; }
  #sidebar hr { border: none; border-top: 1px solid #334155; margin: 12px 0; }
  .filter-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 6px; cursor: pointer; }
  .filter-check input { accent-color: #3b82f6; }
  .sev-high { color: #f87171; }
  .sev-medium { color: #fbbf24; }
  .sev-low { color: #94a3b8; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
  #search-input { flex: 1; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 6px; font-size: 14px; outline: none; }
  #search-input:focus { border-color: #3b82f6; }
  .btn { background: #334155; color: #94a3b8; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .btn:hover { background: #475569; color: #e2e8f0; }
  .issues { flex: 1; min-width: 0; }
  .issue { background: #1e293b; border-radius: 6px; padding: 12px 16px; margin-bottom: 6px; border-left: 3px solid #334155; }
  .issue.sev-high { border-left-color: #ef4444; }
  .issue.sev-medium { border-left-color: #f59e0b; }
  .issue.sev-low { border-left-color: #64748b; }
  .issue-file { font-size: 11px; color: #64748b; margin-bottom: 4px; font-family: monospace; }
  .issue-code { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
  .issue-code.sev-high { color: #f87171; }
  .issue-code.sev-medium { color: #fbbf24; }
  .issue-code.sev-low { color: #94a3b8; }
  .issue-msg { font-size: 13px; color: #94a3b8; }
  .group-header { font-size: 12px; color: #3b82f6; margin: 16px 0 6px; font-family: monospace; }
  #empty-msg { text-align: center; color: #64748b; padding: 40px; display: none; }
  #count-label { font-size: 12px; color: #64748b; margin-bottom: 8px; }
</style>
</head>
<body>
<script>const REPORT_DATA = ${jsonData};</script>

<div class="header">
  <h1>candl-parser</h1>
  <span style="color:#64748b;font-size:14px">· ${meta.project} · ${meta.date.split('T')[0]}</span>
  <span class="meta">${meta.filesScanned} plików · ${meta.filesFromCache} z cache</span>
</div>

<div class="dashboard">
  <div class="stat-card stat-high"><div class="stat-num">${summary.bySeverity.high}</div><div class="stat-label">High</div></div>
  <div class="stat-card stat-medium"><div class="stat-num">${summary.bySeverity.medium}</div><div class="stat-label">Medium</div></div>
  <div class="stat-card stat-low"><div class="stat-num">${summary.bySeverity.low}</div><div class="stat-label">Low</div></div>
  <div class="stat-card"><div class="stat-num">${summary.total}</div><div class="stat-label">Total</div></div>
  <div class="cats">
    <h3>Per kategoria</h3>
    ${categoryBars}
  </div>
</div>

<div class="main">
  <div id="sidebar">
    <h3>Severity</h3>
    ${severityCheckboxes}
    <hr>
    <h3>Kategoria</h3>
    ${categoryCheckboxes}
    <hr>
    <button class="btn" style="width:100%;margin-bottom:6px" onclick="toggleGrouping()">Grupuj: <span id="group-label">plik</span></button>
    <button class="btn" style="width:100%" onclick="exportJson()">JSON</button>
  </div>

  <div class="issues">
    <div class="toolbar">
      <input id="search-input" placeholder="szukaj pliku, kodu, tresci..." oninput="applyFilters()">
      <button class="btn" onclick="sortBy('severity')">Severity</button>
      <button class="btn" onclick="sortBy('file')">Plik</button>
    </div>
    <div id="count-label"></div>
    <div id="issue-list"></div>
    <div id="empty-msg">Brak wynikow dla aktualnych filtrow.</div>
  </div>
</div>

<script>
let groupByFile = true;
let currentSort = 'severity';
let filtered = [...REPORT_DATA.issues];

function getCategoryForCode(code) {
    const prefix = code.split('_')[0];
    const map = { HYDRATION: 'Hydration', BUILD: 'Build', TREESHAKE: 'Tree-shaking', PINIA: 'Pinia' };
    return map[prefix] || 'Nuxt/Vue';
}

function applyFilters() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const activeSeverities = new Set(
        [...document.querySelectorAll('[data-severity]')]
            .filter(el => el.checked).map(el => el.dataset.severity)
    );
    const activeCategories = new Set(
        [...document.querySelectorAll('[data-category]')]
            .filter(el => el.checked).map(el => el.dataset.category)
    );

    filtered = REPORT_DATA.issues.filter(issue => {
        if (!activeSeverities.has(issue.severity)) return false;
        if (!activeCategories.has(getCategoryForCode(issue.code))) return false;
        if (query && !issue.filePath.toLowerCase().includes(query) &&
            !issue.code.toLowerCase().includes(query) &&
            !issue.message.toLowerCase().includes(query)) return false;
        return true;
    });

    if (currentSort === 'severity') {
        const order = { high: 0, medium: 1, low: 2 };
        filtered.sort((a, b) => order[a.severity] - order[b.severity]);
    } else {
        filtered.sort((a, b) => a.filePath.localeCompare(b.filePath));
    }

    renderIssues();
}

function renderIssues() {
    const list = document.getElementById('issue-list');
    const empty = document.getElementById('empty-msg');
    const countLabel = document.getElementById('count-label');
    countLabel.textContent = filtered.length + ' / ' + REPORT_DATA.issues.length + ' problemow';

    if (filtered.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    if (groupByFile) {
        const byFile = {};
        filtered.forEach(i => { (byFile[i.filePath] = byFile[i.filePath] || []).push(i); });
        list.innerHTML = Object.entries(byFile).map(([file, issues]) =>
            '<div class="group-header">' + file + '</div>' +
            issues.map(renderIssueHtml).join('')
        ).join('');
    } else {
        list.innerHTML = filtered.map(renderIssueHtml).join('');
    }
}

function renderIssueHtml(issue) {
    return '<div class="issue sev-' + issue.severity + '">' +
        '<div class="issue-file">' + issue.filePath + '</div>' +
        '<div class="issue-code sev-' + issue.severity + '">' + issue.code + '</div>' +
        '<div class="issue-msg">' + issue.message.replace(/</g, '&lt;') + '</div>' +
        '</div>';
}

function sortBy(field) { currentSort = field; applyFilters(); }

function toggleGrouping() {
    groupByFile = !groupByFile;
    document.getElementById('group-label').textContent = groupByFile ? 'plik' : 'regula';
    renderIssues();
}

function exportJson() {
    const blob = new Blob([JSON.stringify({ ...REPORT_DATA, issues: filtered }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'candl-report-filtered.json';
    a.click();
}

applyFilters();
</script>
</body>
</html>`;
}

export function saveHtmlReport(data: ReportData, outputPath: string): void {
    fs.writeFileSync(outputPath, generateHtmlReport(data), 'utf-8');
}
