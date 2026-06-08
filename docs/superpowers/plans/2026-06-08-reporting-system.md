# Reporting System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zastąpić prosty terminal dump zaawansowanym systemem raportowania z terminal summary, HTML dashboardem z filtrowaniem, JSON exportem, cache'em przyrostowym i pakowaniem NPM.

**Architecture:** Dwa nowe moduły (`src/reporter/`, `src/cache/`) integrowane w istniejący `src/index.ts`. Reporter/terminal zastępuje `outro()`, zachowując `note()` per plik. Cache przechowuje hash per plik (szybkość) + pełny JSON (historia). HTML raport to self-contained plik z embedded vanilla JS.

**Tech Stack:** Bun, TypeScript, `@clack/prompts` (już w projekcie), `picocolors` (już w projekcie), vanilla JS/CSS w HTML raporcie (bez nowych zależności).

---

## Mapa plików

| Akcja | Plik | Odpowiedzialność |
|-------|------|-----------------|
| CREATE | `src/reporter/types.ts` | Wspólne interfejsy: `ReportData`, `ReportIssue`, `ReportSummary`, `CacheDiff` |
| CREATE | `src/reporter/terminal.ts` | Progress bary per kategoria, diff display, zastępuje `outro()` |
| CREATE | `src/reporter/json.ts` | Serializacja wyników do `candl-report.json` |
| CREATE | `src/reporter/html.ts` | Generator self-contained HTML dashboardu |
| CREATE | `src/reporter/index.ts` | Orkiestracja: pyta o HTML/JSON export, wywołuje reportery |
| CREATE | `src/cache/file-hash.ts` | SHA-256 hash per plik, porównywanie z cache |
| CREATE | `src/cache/report-store.ts` | Zapis/odczyt wyników i last-report, obliczanie diffa |
| MODIFY | `src/index.ts` | Integracja cache + reporter, przebudowa pipeline |
| MODIFY | `package.json` | name, bin, files, keywords, version |
| CREATE | `candl-bin` | Wrapper script z shebang dla `npx candl` |

---

## Task 1: Wspólne typy (`src/reporter/types.ts`)

**Files:**
- Create: `src/reporter/types.ts`
- Create: `src/reporter/types.test.ts`

- [ ] **Krok 1: Utwórz plik typów**

```typescript
// src/reporter/types.ts

export type Severity = 'low' | 'medium' | 'high';

export interface ReportIssue {
    filePath: string;
    code: string;
    severity: Severity;
    message: string;
}

export interface ReportSummary {
    total: number;
    bySeverity: { high: number; medium: number; low: number };
    byCategory: Record<string, number>;
}

export interface ReportMeta {
    date: string;           // ISO 8601
    project: string;        // path.basename(targetDir)
    version: string;        // z package.json
    filesScanned: number;
    filesFromCache: number;
}

export interface ReportData {
    meta: ReportMeta;
    summary: ReportSummary;
    issues: ReportIssue[];
}

export interface CacheDiff {
    added: number;
    fixed: number;
}

export const CATEGORY_MAP: Record<string, string> = {
    HYDRATION: 'Hydration',
    BUILD: 'Build',
    TREESHAKE: 'Tree-shaking',
    PINIA: 'Pinia',
    NUXT: 'Nuxt/Vue',
    COMPOSABLE: 'Nuxt/Vue',
    ISLAND: 'Nuxt/Vue',
    UNUSED: 'Nuxt/Vue',
};

export function getCategoryForCode(code: string): string {
    const prefix = code.split('_')[0] ?? 'NUXT';
    return CATEGORY_MAP[prefix] ?? 'Nuxt/Vue';
}

export function buildSummary(issues: ReportIssue[]): ReportSummary {
    const bySeverity = { high: 0, medium: 0, low: 0 };
    const byCategory: Record<string, number> = {};

    for (const issue of issues) {
        bySeverity[issue.severity]++;
        const cat = getCategoryForCode(issue.code);
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    return { total: issues.length, bySeverity, byCategory };
}
```

- [ ] **Krok 2: Napisz test**

```typescript
// src/reporter/types.test.ts
import { test, expect, describe } from 'bun:test';
import { getCategoryForCode, buildSummary } from './types';

describe('getCategoryForCode', () => {
    test('maps HYDRATION_ prefix', () => {
        expect(getCategoryForCode('HYDRATION_BROWSER_GLOBAL')).toBe('Hydration');
    });
    test('maps BUILD_ prefix', () => {
        expect(getCategoryForCode('BUILD_CIRCULAR_DEPENDENCY')).toBe('Build');
    });
    test('maps TREESHAKE_ prefix', () => {
        expect(getCategoryForCode('TREESHAKE_BARREL_FILE')).toBe('Tree-shaking');
    });
    test('maps PINIA_ prefix', () => {
        expect(getCategoryForCode('PINIA_UNUSED_STORE')).toBe('Pinia');
    });
    test('maps COMPOSABLE_ prefix to Nuxt/Vue', () => {
        expect(getCategoryForCode('COMPOSABLE_NO_REACTIVITY')).toBe('Nuxt/Vue');
    });
    test('maps unknown prefix to Nuxt/Vue', () => {
        expect(getCategoryForCode('UNKNOWN_CODE')).toBe('Nuxt/Vue');
    });
});

describe('buildSummary', () => {
    test('counts by severity and category', () => {
        const issues = [
            { filePath: 'a.ts', code: 'HYDRATION_BROWSER_GLOBAL', severity: 'high' as const, message: '' },
            { filePath: 'b.ts', code: 'BUILD_CIRCULAR_DEPENDENCY', severity: 'high' as const, message: '' },
            { filePath: 'c.ts', code: 'TREESHAKE_BARREL_FILE', severity: 'medium' as const, message: '' },
        ];
        const summary = buildSummary(issues);
        expect(summary.total).toBe(3);
        expect(summary.bySeverity.high).toBe(2);
        expect(summary.bySeverity.medium).toBe(1);
        expect(summary.byCategory['Hydration']).toBe(1);
        expect(summary.byCategory['Build']).toBe(1);
        expect(summary.byCategory['Tree-shaking']).toBe(1);
    });
});
```

- [ ] **Krok 3: Uruchom test**

```bash
bun test src/reporter/types.test.ts
```
Oczekiwane: PASS (brak implementacji do napisania — typy i funkcje są już w pliku)

- [ ] **Krok 4: Sprawdź typy**

```bash
bun run tsc --noEmit
```
Oczekiwane: brak błędów

- [ ] **Krok 5: Commit**

```bash
git add src/reporter/types.ts src/reporter/types.test.ts
git commit -m "feat: add shared reporter types and category mapping"
```

---

## Task 2: Cache — haszowanie plików (`src/cache/file-hash.ts`)

**Files:**
- Create: `src/cache/file-hash.ts`
- Create: `src/cache/file-hash.test.ts`

- [ ] **Krok 1: Napisz testy (TDD)**

```typescript
// src/cache/file-hash.test.ts
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { computeFileHash, getChangedFiles } from './file-hash';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candl-hash-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

describe('computeFileHash', () => {
    test('returns hex string of length 64', async () => {
        const f = path.join(tmpDir, 'test.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const hash = await computeFileHash(f);
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    test('same content = same hash', async () => {
        const f1 = path.join(tmpDir, 'a.ts');
        const f2 = path.join(tmpDir, 'b.ts');
        fs.writeFileSync(f1, 'const x = 1;');
        fs.writeFileSync(f2, 'const x = 1;');
        expect(await computeFileHash(f1)).toBe(await computeFileHash(f2));
    });

    test('different content = different hash', async () => {
        const f1 = path.join(tmpDir, 'a.ts');
        const f2 = path.join(tmpDir, 'b.ts');
        fs.writeFileSync(f1, 'const x = 1;');
        fs.writeFileSync(f2, 'const x = 2;');
        expect(await computeFileHash(f1)).not.toBe(await computeFileHash(f2));
    });
});

describe('getChangedFiles', () => {
    test('marks all files as changed when cache is empty', async () => {
        const f = path.join(tmpDir, 'a.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const result = await getChangedFiles([f], {});
        expect(result.changed).toContain(f);
        expect(result.unchanged).toHaveLength(0);
    });

    test('marks unchanged files correctly', async () => {
        const f = path.join(tmpDir, 'a.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const hash = await computeFileHash(f);
        const result = await getChangedFiles([f], { [f]: hash });
        expect(result.unchanged).toContain(f);
        expect(result.changed).toHaveLength(0);
    });

    test('marks modified files as changed', async () => {
        const f = path.join(tmpDir, 'a.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const result = await getChangedFiles([f], { [f]: 'old-hash-abc' });
        expect(result.changed).toContain(f);
    });
});
```

- [ ] **Krok 2: Uruchom testy — sprawdź że failują**

```bash
bun test src/cache/file-hash.test.ts
```
Oczekiwane: FAIL — "Cannot find module './file-hash'"

- [ ] **Krok 3: Implementuj**

```typescript
// src/cache/file-hash.ts
export type FileHashCache = Record<string, string>;

export async function computeFileHash(filePath: string): Promise<string> {
    const buffer = await Bun.file(filePath).arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function getChangedFiles(
    files: string[],
    cache: FileHashCache,
): Promise<{ changed: string[]; unchanged: string[] }> {
    const changed: string[] = [];
    const unchanged: string[] = [];

    await Promise.all(files.map(async (f) => {
        const hash = await computeFileHash(f);
        if (cache[f] === hash) {
            unchanged.push(f);
        } else {
            changed.push(f);
        }
    }));

    return { changed, unchanged };
}

export async function buildHashSnapshot(files: string[]): Promise<FileHashCache> {
    const entries = await Promise.all(
        files.map(async (f) => [f, await computeFileHash(f)] as const)
    );
    return Object.fromEntries(entries);
}
```

- [ ] **Krok 4: Uruchom testy**

```bash
bun test src/cache/file-hash.test.ts
```
Oczekiwane: PASS wszystkie testy

- [ ] **Krok 5: Commit**

```bash
git add src/cache/file-hash.ts src/cache/file-hash.test.ts
git commit -m "feat: add file hash cache for incremental analysis"
```

---

## Task 3: Cache — report store (`src/cache/report-store.ts`)

**Files:**
- Create: `src/cache/report-store.ts`
- Create: `src/cache/report-store.test.ts`

- [ ] **Krok 1: Napisz testy**

```typescript
// src/cache/report-store.test.ts
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { saveReportStore, loadReportStore, diffReports } from './report-store';
import type { StoredResults, LastReport } from './report-store';
import fs from 'fs';
import path from 'path';
import os from 'os';

let cacheDir: string;
beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candl-store-')); });
afterEach(() => { fs.rmSync(cacheDir, { recursive: true }); });

describe('saveReportStore / loadReportStore', () => {
    test('returns null when no cache exists', () => {
        const result = loadReportStore(cacheDir);
        expect(result).toBeNull();
    });

    test('saves and loads results correctly', () => {
        const results: StoredResults = {
            'a.ts': { filePath: 'a.ts', anomalies: [{ code: 'BUILD_X', severity: 'high', message: 'test' }] }
        };
        const report: LastReport = {
            date: '2026-06-08',
            totalIssues: 1,
            byCategory: { Build: 1 },
            bySeverity: { high: 1, medium: 0, low: 0 },
        };
        saveReportStore(cacheDir, results, report);
        const loaded = loadReportStore(cacheDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.results['a.ts'].anomalies[0].code).toBe('BUILD_X');
        expect(loaded!.lastReport.totalIssues).toBe(1);
    });
});

describe('diffReports', () => {
    test('calculates added and fixed issues', () => {
        const previous: LastReport = {
            date: '2026-06-07', totalIssues: 5,
            byCategory: {}, bySeverity: { high: 2, medium: 2, low: 1 },
        };
        const current: LastReport = {
            date: '2026-06-08', totalIssues: 6,
            byCategory: {}, bySeverity: { high: 3, medium: 2, low: 1 },
        };
        const diff = diffReports(current, previous);
        expect(diff.added).toBe(1);
        expect(diff.fixed).toBe(0);
    });

    test('calculates fixed issues', () => {
        const previous: LastReport = {
            date: '2026-06-07', totalIssues: 5,
            byCategory: {}, bySeverity: { high: 2, medium: 2, low: 1 },
        };
        const current: LastReport = {
            date: '2026-06-08', totalIssues: 3,
            byCategory: {}, bySeverity: { high: 1, medium: 1, low: 1 },
        };
        const diff = diffReports(current, previous);
        expect(diff.added).toBe(0);
        expect(diff.fixed).toBe(2);
    });
});
```

- [ ] **Krok 2: Uruchom testy — sprawdź że failują**

```bash
bun test src/cache/report-store.test.ts
```
Oczekiwane: FAIL

- [ ] **Krok 3: Implementuj**

```typescript
// src/cache/report-store.ts
import fs from 'fs';
import path from 'path';
import type { FileAnalysisResult } from '../analyzers/composable';
import type { CacheDiff } from '../reporter/types';

export type StoredResults = Record<string, FileAnalysisResult>;

export interface LastReport {
    date: string;
    totalIssues: number;
    byCategory: Record<string, number>;
    bySeverity: { high: number; medium: number; low: number };
}

interface CacheStore {
    results: StoredResults;
    lastReport: LastReport;
}

const RESULTS_FILE = 'results.json';
const LAST_REPORT_FILE = 'last-report.json';

export function loadReportStore(cacheDir: string): CacheStore | null {
    const resultsPath = path.join(cacheDir, RESULTS_FILE);
    const lastReportPath = path.join(cacheDir, LAST_REPORT_FILE);

    if (!fs.existsSync(resultsPath) || !fs.existsSync(lastReportPath)) return null;

    try {
        const results: StoredResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
        const lastReport: LastReport = JSON.parse(fs.readFileSync(lastReportPath, 'utf-8'));
        return { results, lastReport };
    } catch {
        return null;
    }
}

export function saveReportStore(
    cacheDir: string,
    results: StoredResults,
    lastReport: LastReport,
): void {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, RESULTS_FILE), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(cacheDir, LAST_REPORT_FILE), JSON.stringify(lastReport, null, 2));
}

export function diffReports(current: LastReport, previous: LastReport): CacheDiff {
    const delta = current.totalIssues - previous.totalIssues;
    return {
        added: Math.max(0, delta),
        fixed: Math.max(0, -delta),
    };
}

export function buildLastReport(
    issues: Array<{ severity: string; code: string }>,
    getCategoryForCode: (code: string) => string,
): LastReport {
    const bySeverity = { high: 0, medium: 0, low: 0 };
    const byCategory: Record<string, number> = {};

    for (const issue of issues) {
        if (issue.severity === 'high' || issue.severity === 'medium' || issue.severity === 'low') {
            bySeverity[issue.severity]++;
        }
        const cat = getCategoryForCode(issue.code);
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    return {
        date: new Date().toISOString(),
        totalIssues: issues.length,
        byCategory,
        bySeverity,
    };
}
```

- [ ] **Krok 4: Uruchom testy**

```bash
bun test src/cache/report-store.test.ts
```
Oczekiwane: PASS

- [ ] **Krok 5: Commit**

```bash
git add src/cache/report-store.ts src/cache/report-store.test.ts
git commit -m "feat: add report store cache with diff calculation"
```

---

## Task 4: Reporter — terminal (`src/reporter/terminal.ts`)

**Files:**
- Create: `src/reporter/terminal.ts`
- Create: `src/reporter/terminal.test.ts`

- [ ] **Krok 1: Napisz testy**

```typescript
// src/reporter/terminal.test.ts
import { test, expect, describe } from 'bun:test';
import { renderProgressBar, renderCategoryBars, renderDiffLine } from './terminal';

describe('renderProgressBar', () => {
    test('full bar when max=count', () => {
        const bar = renderProgressBar(10, 10, 10);
        expect(bar).toContain('██████████');
    });

    test('empty bar when count=0', () => {
        const bar = renderProgressBar(0, 10, 10);
        expect(bar).toContain('░░░░░░░░░░');
    });

    test('partial bar', () => {
        const bar = renderProgressBar(5, 10, 10);
        expect(bar).toContain('█████░░░░░');
    });
});

describe('renderCategoryBars', () => {
    test('generates one line per category', () => {
        const summary = {
            total: 5,
            bySeverity: { high: 1, medium: 2, low: 2 },
            byCategory: { Hydration: 3, Build: 2 },
        };
        const output = renderCategoryBars(summary);
        expect(output).toContain('Hydration');
        expect(output).toContain('Build');
    });

    test('shows checkmark for zero-issue category', () => {
        const summary = {
            total: 1,
            bySeverity: { high: 1, medium: 0, low: 0 },
            byCategory: { Hydration: 1, Pinia: 0 },
        };
        const output = renderCategoryBars(summary);
        expect(output).toContain('✓');
    });
});

describe('renderDiffLine', () => {
    test('shows added and fixed when both non-zero', () => {
        const line = renderDiffLine({ added: 2, fixed: 1 });
        expect(line).toContain('+2');
        expect(line).toContain('-1');
    });

    test('returns empty string when no diff', () => {
        expect(renderDiffLine({ added: 0, fixed: 0 })).toBe('');
    });

    test('returns empty string for null diff', () => {
        expect(renderDiffLine(null)).toBe('');
    });
});
```

- [ ] **Krok 2: Uruchom — sprawdź że failują**

```bash
bun test src/reporter/terminal.test.ts
```
Oczekiwane: FAIL

- [ ] **Krok 3: Implementuj**

```typescript
// src/reporter/terminal.ts
import pc from 'picocolors';
import type { ReportSummary, CacheDiff } from './types';

const BAR_WIDTH = 10;

export function renderProgressBar(count: number, max: number, width = BAR_WIDTH): string {
    const filled = max === 0 ? 0 : Math.round((count / max) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function renderCategoryBars(summary: ReportSummary): string {
    const allCategories = ['Hydration', 'Build', 'Tree-shaking', 'Nuxt/Vue', 'Pinia'];
    const maxCount = Math.max(...Object.values(summary.byCategory), 1);
    const labelWidth = Math.max(...allCategories.map(c => c.length));

    return allCategories.map(cat => {
        const count = summary.byCategory[cat] ?? 0;
        const label = cat.padEnd(labelWidth);
        if (count === 0) {
            return `  ${pc.dim(label)}  ${'░'.repeat(BAR_WIDTH)}  ${pc.green('0 issues  ✓')}`;
        }
        const bar = renderProgressBar(count, maxCount);
        const hasHigh = (summary.byCategory[cat] ?? 0) > 0;
        const color = hasHigh ? pc.yellow : pc.dim;
        return `  ${pc.dim(label)}  ${color(bar)}  ${count} issues`;
    }).join('\n');
}

export function renderDiffLine(diff: CacheDiff | null): string {
    if (!diff || (diff.added === 0 && diff.fixed === 0)) return '';
    const parts: string[] = [];
    if (diff.added > 0) parts.push(pc.red(`↑ +${diff.added} nowe`));
    if (diff.fixed > 0) parts.push(pc.green(`↓ -${diff.fixed} naprawione`));
    return `  ${parts.join('  ')}  ${pc.dim('(vs. poprzednie skanowanie)')}`;
}

export function printTerminalSummary(
    summary: ReportSummary,
    filesScanned: number,
    filesFromCache: number,
    diff: CacheDiff | null,
): void {
    const cacheNote = filesFromCache > 0 ? pc.dim(` (${filesFromCache} pominiętych z cache)`) : '';
    console.log(`\n  Przeanalizowano ${pc.bold(String(filesScanned))} plików${cacheNote}\n`);
    console.log(renderCategoryBars(summary));

    const diffLine = renderDiffLine(diff);
    if (diffLine) console.log(`\n${diffLine}`);

    const total = summary.total;
    const severityNote = summary.bySeverity.high > 0
        ? pc.red(`${total} problemów`)
        : total > 0 ? pc.yellow(`${total} problemów`) : pc.green('0 problemów');
    console.log(`\n  Znaleziono ${severityNote} do optymalizacji.\n`);
}
```

- [ ] **Krok 4: Uruchom testy**

```bash
bun test src/reporter/terminal.test.ts
```
Oczekiwane: PASS

- [ ] **Krok 5: Commit**

```bash
git add src/reporter/terminal.ts src/reporter/terminal.test.ts
git commit -m "feat: add terminal reporter with progress bars and diff"
```

---

## Task 5: Reporter — JSON (`src/reporter/json.ts`)

**Files:**
- Create: `src/reporter/json.ts`
- Create: `src/reporter/json.test.ts`

- [ ] **Krok 1: Napisz testy**

```typescript
// src/reporter/json.test.ts
import { test, expect, describe } from 'bun:test';
import { buildReportData, serializeReport } from './json';
import type { FileAnalysisResult } from '../analyzers/composable';

describe('buildReportData', () => {
    test('converts FileAnalysisResult[] to ReportData', () => {
        const results: FileAnalysisResult[] = [
            {
                filePath: '/project/composables/useAuth.ts',
                anomalies: [{ code: 'BUILD_CIRCULAR_DEPENDENCY', severity: 'high', message: 'Circular: A → B → A' }],
            },
        ];
        const data = buildReportData(results, 10, 3, 'my-project');
        expect(data.meta.project).toBe('my-project');
        expect(data.meta.filesScanned).toBe(10);
        expect(data.meta.filesFromCache).toBe(3);
        expect(data.summary.total).toBe(1);
        expect(data.summary.bySeverity.high).toBe(1);
        expect(data.issues[0].code).toBe('BUILD_CIRCULAR_DEPENDENCY');
        expect(data.issues[0].filePath).toBe('/project/composables/useAuth.ts');
    });

    test('handles empty results', () => {
        const data = buildReportData([], 5, 0, 'project');
        expect(data.summary.total).toBe(0);
        expect(data.issues).toHaveLength(0);
    });
});

describe('serializeReport', () => {
    test('returns valid JSON string', () => {
        const data = buildReportData([], 1, 0, 'test');
        const json = serializeReport(data);
        expect(() => JSON.parse(json)).not.toThrow();
    });
});
```

- [ ] **Krok 2: Uruchom — sprawdź że failują**

```bash
bun test src/reporter/json.test.ts
```
Oczekiwane: FAIL

- [ ] **Krok 3: Implementuj**

```typescript
// src/reporter/json.ts
import fs from 'fs';
import path from 'path';
import type { FileAnalysisResult } from '../analyzers/composable';
import { buildSummary, getCategoryForCode, type ReportData, type ReportIssue } from './types';

export function buildReportData(
    allResults: FileAnalysisResult[],
    filesScanned: number,
    filesFromCache: number,
    project: string,
): ReportData {
    const issues: ReportIssue[] = allResults.flatMap(r =>
        r.anomalies.map(a => ({
            filePath: r.filePath,
            code: a.code,
            severity: a.severity,
            message: a.message,
        }))
    );

    return {
        meta: {
            date: new Date().toISOString(),
            project,
            version: '0.2.0',
            filesScanned,
            filesFromCache,
        },
        summary: buildSummary(issues),
        issues,
    };
}

export function serializeReport(data: ReportData): string {
    return JSON.stringify(data, null, 2);
}

export function saveJsonReport(data: ReportData, outputPath: string): void {
    fs.writeFileSync(outputPath, serializeReport(data), 'utf-8');
}
```

- [ ] **Krok 4: Uruchom testy**

```bash
bun test src/reporter/json.test.ts
```
Oczekiwane: PASS

- [ ] **Krok 5: Commit**

```bash
git add src/reporter/json.ts src/reporter/json.test.ts
git commit -m "feat: add JSON report serializer"
```

---

## Task 6: Reporter — HTML (`src/reporter/html.ts`)

**Files:**
- Create: `src/reporter/html.ts`
- Create: `src/reporter/html.test.ts`

- [ ] **Krok 1: Napisz testy**

```typescript
// src/reporter/html.test.ts
import { test, expect, describe } from 'bun:test';
import { generateHtmlReport } from './html';
import type { ReportData } from './types';

const sampleData: ReportData = {
    meta: { date: '2026-06-08T12:00:00Z', project: 'test-project', version: '0.2.0', filesScanned: 10, filesFromCache: 2 },
    summary: {
        total: 2,
        bySeverity: { high: 1, medium: 1, low: 0 },
        byCategory: { Build: 1, Hydration: 1 },
    },
    issues: [
        { filePath: 'composables/useAuth.ts', code: 'BUILD_CIRCULAR_DEPENDENCY', severity: 'high', message: 'Circular: A → B' },
        { filePath: 'pages/index.vue', code: 'HYDRATION_BROWSER_GLOBAL', severity: 'medium', message: 'window bez onMounted' },
    ],
};

describe('generateHtmlReport', () => {
    test('returns a string starting with <!DOCTYPE html>', () => {
        const html = generateHtmlReport(sampleData);
        expect(html).toMatch(/^<!DOCTYPE html>/);
    });

    test('embeds REPORT_DATA JSON', () => {
        const html = generateHtmlReport(sampleData);
        expect(html).toContain('const REPORT_DATA =');
        expect(html).toContain('BUILD_CIRCULAR_DEPENDENCY');
    });

    test('contains project name in title', () => {
        const html = generateHtmlReport(sampleData);
        expect(html).toContain('test-project');
    });

    test('contains all severity counts', () => {
        const html = generateHtmlReport(sampleData);
        expect(html).toContain('>1<'); // HIGH count
        expect(html).toContain('>2<'); // TOTAL count
    });

    test('contains filter panel elements', () => {
        const html = generateHtmlReport(sampleData);
        expect(html).toContain('id="search-input"');
        expect(html).toContain('id="sidebar"');
        expect(html).toContain('exportJson');
    });
});
```

- [ ] **Krok 2: Uruchom — sprawdź że failują**

```bash
bun test src/reporter/html.test.ts
```
Oczekiwane: FAIL

- [ ] **Krok 3: Implementuj `generateHtmlReport`**

```typescript
// src/reporter/html.ts
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
  .btn.active { background: #1d4ed8; color: #fff; }
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
  <h1>🕯️ candl-parser</h1>
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
    <button class="btn" style="width:100%" onclick="exportJson()">⬇ JSON</button>
  </div>

  <div class="issues">
    <div class="toolbar">
      <input id="search-input" placeholder="🔍 szukaj pliku, kodu, treści..." oninput="applyFilters()">
      <button class="btn" onclick="sortBy('severity')">↕ Severity</button>
      <button class="btn" onclick="sortBy('file')">↕ Plik</button>
    </div>
    <div id="count-label"></div>
    <div id="issue-list"></div>
    <div id="empty-msg">Brak wyników dla aktualnych filtrów.</div>
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
    countLabel.textContent = filtered.length + ' / ' + REPORT_DATA.issues.length + ' problemów';

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
            '<div class="group-header">📄 ' + file + '</div>' +
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
    document.getElementById('group-label').textContent = groupByFile ? 'plik' : 'reguła';
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
```

- [ ] **Krok 4: Uruchom testy**

```bash
bun test src/reporter/html.test.ts
```
Oczekiwane: PASS

- [ ] **Krok 5: Commit**

```bash
git add src/reporter/html.ts src/reporter/html.test.ts
git commit -m "feat: add self-contained HTML dashboard report generator"
```

---

## Task 7: Reporter — orkiestracja (`src/reporter/index.ts`)

**Files:**
- Create: `src/reporter/index.ts`

Brak osobnych testów — ta warstwa tylko orkiestruje `@clack/prompts` (I/O side effects); testowana przez integrację.

- [ ] **Krok 1: Implementuj**

```typescript
// src/reporter/index.ts
import { confirm } from '@clack/prompts';
import path from 'path';
import pc from 'picocolors';
import type { ReportData } from './types';
import type { CacheDiff } from './types';
import { printTerminalSummary } from './terminal';
import { saveHtmlReport } from './html';
import { saveJsonReport } from './json';

export async function runReporter(
    data: ReportData,
    diff: CacheDiff | null,
    targetDir: string,
): Promise<void> {
    printTerminalSummary(data.summary, data.meta.filesScanned, data.meta.filesFromCache, diff);

    if (data.summary.total === 0) return;

    const openHtml = await confirm({ message: 'Otwórz raport HTML w przeglądarce?' });
    if (openHtml === true) {
        const htmlPath = path.join(targetDir, 'candl-report.html');
        saveHtmlReport(data, htmlPath);
        // Otwórz w przeglądarce — cross-platform
        const opener = process.platform === 'win32' ? 'start'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
        Bun.spawn([opener, htmlPath]);
        console.log(pc.dim(`  → zapisano: ${path.relative(process.cwd(), htmlPath)}`));
    }

    const saveJson = await confirm({ message: 'Zapisz candl-report.json?' });
    if (saveJson === true) {
        const jsonPath = path.join(targetDir, 'candl-report.json');
        saveJsonReport(data, jsonPath);
        console.log(pc.dim(`  → zapisano: ${path.relative(process.cwd(), jsonPath)}`));
    }
}
```

- [ ] **Krok 2: Sprawdź typy**

```bash
bun run tsc --noEmit
```
Oczekiwane: brak błędów

- [ ] **Krok 3: Commit**

```bash
git add src/reporter/index.ts
git commit -m "feat: add reporter orchestration with HTML/JSON export prompts"
```

---

## Task 8: Integracja `src/index.ts`

**Files:**
- Modify: `src/index.ts`

To jest największy krok — przebudowa pipeline. Istniejące `note()` per plik zostają. `outro()` zastępujemy nowym reporterem.

- [ ] **Krok 1: Dodaj importy na górze pliku** (dodaj do istniejących importów)

```typescript
import path from 'path';
import { findVueFiles, findComposableFiles, findStoreFiles, findTypeScriptFiles } from './scanner';
import { analyzeVueFile, type AnalysisResult } from './analyzer';
import { analyzeComposableFile, type FileAnalysisResult } from './analyzers/composable';
import { analyzePiniaProject } from './analyzers/pinia';
import { analyzeIsland } from './analyzers/island';
import { analyzeTreeShaking } from './analyzers/tree-shaking';
import { analyzeBuildSpeed } from './analyzers/build-speed';
import { buildReportData } from './reporter/json';
import { runReporter } from './reporter/index';
import { getCategoryForCode } from './reporter/types';
import { getChangedFiles, buildHashSnapshot, type FileHashCache } from './cache/file-hash';
import { loadReportStore, saveReportStore, diffReports, buildLastReport, type StoredResults } from './cache/report-store';
```

- [ ] **Krok 2: Zdefiniuj ścieżkę cache** — dodaj po ustaleniu `targetPath`

Znajdź linię:
```typescript
const targetPath = path.resolve(process.cwd(), target);
```
i dodaj **po niej**:
```typescript
const cacheDir = path.join(targetPath, '.candl-cache');
```

- [ ] **Krok 3: Załaduj cache przed analizą** — dodaj po `s.start(...)`:

```typescript
// Załaduj cache
const cacheStore = loadReportStore(cacheDir);
const prevHashCache: FileHashCache = cacheStore
    ? JSON.parse(fs.readFileSync(path.join(cacheDir, 'hashes.json'), 'utf-8').catch?.(() => '{}') ?? '{}')
    : {};
```

Ponieważ `hashes.json` jest osobnym plikiem, zmodyfikuj to na bardziej niezawodne wczytanie:
```typescript
import path from 'path';

// Załaduj hash cache
let prevHashCache: FileHashCache = {};
const hashCachePath = path.join(cacheDir, 'hashes.json');
if (fs.existsSync(hashCachePath)) {
    try { prevHashCache = JSON.parse(fs.readFileSync(hashCachePath, 'utf-8')); } catch { /* ignore */ }
}
const cacheStore = loadReportStore(cacheDir);
```

- [ ] **Krok 4: Zmień pętlę analizy .vue na cache-aware**

Znajdź:
```typescript
const results: AnalysisResult[] = [];
const islandResults: FileAnalysisResult[] = [];
for (const file of vueFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const res = analyzeVueFile(file, content);
    if (res && res.status !== 'ok') {
        results.push(res);
    }
    const islandRes = analyzeIsland(file, content);
    if (islandRes.anomalies.length > 0) islandResults.push(islandRes);
}
```

Zastąp:
```typescript
// Sprawdź które pliki wymagają ponownej analizy
const tsFiles = findTypeScriptFiles(targetPath);
const allFilesForAnalysis = [...vueFiles, ...tsFiles];
const { changed: changedFiles, unchanged: unchangedFiles } =
    await getChangedFiles(allFilesForAnalysis, prevHashCache);

// Wczytaj wyniki dla niezminionych plików z cache
const cachedResults: FileAnalysisResult[] = unchangedFiles
    .map(f => cacheStore?.results[f])
    .filter((r): r is FileAnalysisResult => r !== undefined);

// Analizuj zmienione pliki .vue
const results: AnalysisResult[] = [];
const islandResults: FileAnalysisResult[] = [];
const changedVueFiles = vueFiles.filter(f => changedFiles.includes(f));
for (const file of changedVueFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const res = analyzeVueFile(file, content);
    if (res && res.status !== 'ok') {
        results.push(res);
    }
    const islandRes = analyzeIsland(file, content);
    if (islandRes.anomalies.length > 0) islandResults.push(islandRes);
}
```

- [ ] **Krok 5: Ogranicz composables, pinia, tree-shaking, build-speed do zmienionych plików**

Znajdź sekcję `// 4b. Analiza composables` i zmień:
```typescript
// 4b. Analiza composables (tylko zmienione)
const composableFiles = findComposableFiles(targetPath);
const composableResults: FileAnalysisResult[] = [];
const changedComposables = composableFiles.filter(f => changedFiles.includes(f));
for (const file of changedComposables) {
    const content = fs.readFileSync(file, 'utf-8');
    const res = analyzeComposableFile(file, content);
    if (res.anomalies.length > 0) composableResults.push(res);
}

// 4c. Pinia — cross-file, zawsze pełna analiza (zależności cross-file)
const storeFiles = findStoreFiles(targetPath);
const allProjectFiles = [...vueFiles, ...tsFiles];
const piniaResults: FileAnalysisResult[] = analyzePiniaProject(storeFiles, allProjectFiles);

// 4d. Tree-shaking (tylko zmienione pliki)
const changedForPerf = allFilesForAnalysis.filter(f => changedFiles.includes(f));
const treeShakingResults: FileAnalysisResult[] = analyzeTreeShaking(changedForPerf);

// 4e. Build speed — cross-file, zawsze pełna analiza
const buildSpeedResults: FileAnalysisResult[] = analyzeBuildSpeed(allFilesForAnalysis);
```

- [ ] **Krok 6: Zaktualizuj spinner stop message**

Zastąp `s.stop(...)` na:
```typescript
s.stop(
    `Przeanalizowano ${pc.bold(String(vueFiles.length))} .vue, ` +
    `${pc.bold(String(tsFiles.length))} .ts` +
    (unchangedFiles.length > 0 ? pc.dim(` (${unchangedFiles.length} z cache)`) : '')
);
```

- [ ] **Krok 7: Zastąp wyświetlanie wyników i outro**

Znajdź całą sekcję od `// 5. Wyświetlanie wyników` do końca funkcji `main()` i zastąp:
```typescript
// 5. Zbierz wszystkie wyniki (nowe + cache)
const freshResults: FileAnalysisResult[] = [
    ...results,
    ...islandResults,
    ...composableResults,
    ...piniaResults,
    ...treeShakingResults,
    ...buildSpeedResults,
];
const allResults: FileAnalysisResult[] = [...freshResults, ...cachedResults];

// 6. Wyświetl note() per plik (tylko dla nowych wyników)
let issuesCount = 0;
freshResults.forEach(result => {
    const relativePath = path.relative(process.cwd(), result.filePath);
    let message = '';
    result.anomalies.forEach(anomaly => {
        issuesCount++;
        const icon = anomaly.severity === 'high' ? pc.red('▲') : anomaly.severity === 'medium' ? pc.yellow('■') : pc.dim('○');
        message += `${icon} [${anomaly.code}] ${anomaly.message}\n`;
    });
    if (message) note(message.trim(), pc.yellow(`Plik: ${relativePath}`));
});

// 7. Zbuduj ReportData
const projectName = path.basename(targetPath);
const reportData = buildReportData(
    allResults,
    allFilesForAnalysis.length,
    unchangedFiles.length,
    projectName,
);

// 8. Diff z poprzednim skanem
const currentLastReport = buildLastReport(reportData.issues, getCategoryForCode);
const diff = cacheStore ? diffReports(currentLastReport, cacheStore.lastReport) : null;

// 9. Uruchom reporter (terminal summary + opcjonalny HTML/JSON)
await runReporter(reportData, diff, targetPath);

// 10. Zapisz cache
const newHashes = await buildHashSnapshot(allFilesForAnalysis);
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(hashCachePath, JSON.stringify(newHashes, null, 2));
const newStoredResults: StoredResults = {};
allResults.forEach(r => { newStoredResults[r.filePath] = r; });
saveReportStore(cacheDir, newStoredResults, currentLastReport);
```

- [ ] **Krok 8: Sprawdź typy i uruchom**

```bash
bun run tsc --noEmit
bun run src/index.ts
```
Oczekiwane: narzędzie uruchamia się, pokazuje nowy terminal summary, pyta o HTML/JSON

- [ ] **Krok 9: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate cache and reporter into main pipeline"
```

---

## Task 9: NPM packaging

**Files:**
- Modify: `package.json`
- Create: `candl-bin`
- Modify: `build.ts` (aktualizacja outfile)

- [ ] **Krok 1: Zaktualizuj `package.json`**

Zastąp całą zawartość:
```json
{
  "name": "candl",
  "version": "0.2.0",
  "description": "Advanced static analyzer for Nuxt 4 / Vue 3",
  "bin": {
    "candl": "./candl-bin"
  },
  "main": "./src/index.ts",
  "files": [
    "src/",
    "candl-bin"
  ],
  "keywords": [
    "nuxt",
    "vue",
    "linter",
    "static-analysis",
    "nuxt4"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "bun run build.ts",
    "dev": "bun run src/index.ts"
  },
  "dependencies": {
    "@babel/traverse": "^7.24.0",
    "@babel/types": "^7.24.0",
    "@babel/parser": "^7.24.0",
    "@clack/prompts": "^0.7.0",
    "@vue/compiler-sfc": "^3.4.0",
    "picocolors": "^1.0.0"
  }
}
```

(Wypełnij rzeczywistymi wersjami z istniejącego `package.json` — nie zmieniaj wersji zależności.)

- [ ] **Krok 2: Utwórz `candl-bin`** (bez rozszerzenia)

```bash
#!/usr/bin/env bun
import('./src/index.ts')
```

Następnie nadaj uprawnienia wykonywania:
```bash
chmod +x candl-bin
```

- [ ] **Krok 3: Sprawdź działanie przez bin**

```bash
./candl-bin
```
Oczekiwane: narzędzie uruchamia się normalnie (identycznie jak `bun run src/index.ts`)

- [ ] **Krok 4: Dodaj `.candl-cache/` do `.gitignore`**

Sprawdź czy `.gitignore` istnieje:
```bash
ls .gitignore 2>/dev/null || echo "brak .gitignore"
```

Dodaj wpisy:
```bash
echo ".candl-cache/" >> .gitignore
echo "candl-report.html" >> .gitignore
echo "candl-report.json" >> .gitignore
echo ".superpowers/" >> .gitignore
```

- [ ] **Krok 5: Skompiluj binary (opcjonalnie, dla release)**

Sprawdź `build.ts` — upewnij się że `--compile` i `--outfile candl-bin` są ustawione:
```typescript
// build.ts — sprawdź że zawiera:
await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './',
    // lub:
    // target: 'bun',
    // compile: true,
});
```

Jeśli `build.ts` używa `Bun.build` bez `compile`, zaktualizuj na:
```bash
# Kompilacja do standalone binary:
bun build src/index.ts --compile --outfile candl-bin
```

Uruchom:
```bash
bun run build.ts
./candl-bin
```
Oczekiwane: binary działa bez Bun w PATH

- [ ] **Krok 6: Commit**

```bash
git add package.json candl-bin .gitignore
git commit -m "feat: npm packaging — bin entry, name=candl, files manifest"
```

---

## Weryfikacja end-to-end

- [ ] **Test 1: Pierwsze uruchomienie (brak cache)**

```bash
bun run src/index.ts
# → wybierz katalog z plikami .vue
# Oczekiwane: terminal summary z progress barami, NIE pokazuje "(X z cache)"
# Oczekiwane: .candl-cache/ pojawia się w katalogu
```

- [ ] **Test 2: Drugie uruchomienie (z cache)**

```bash
bun run src/index.ts
# Oczekiwane: spinner pokazuje "(X pominiętych z cache)"
# Oczekiwane: diff "+0 nowe / -0 naprawione" (jeśli nic nie zmieniono)
```

- [ ] **Test 3: HTML raport**

```bash
bun run src/index.ts
# → na pytanie "Otwórz HTML?" odpowiedz y
# Oczekiwane: przeglądarka otwiera się z dashboardem
# Oczekiwane: filtrowanie po severity i kategorii działa
# Oczekiwane: search po nazwie pliku filtruje listę
# Oczekiwane: "⬇ JSON" pobiera plik z przefiltrowanymi danymi
```

- [ ] **Test 4: Wszystkie testy**

```bash
bun test
# Oczekiwane: PASS wszystkie testy (types, file-hash, report-store, terminal, json, html)
```

- [ ] **Test 5: TypeScript**

```bash
bun run tsc --noEmit
# Oczekiwane: brak błędów
```
