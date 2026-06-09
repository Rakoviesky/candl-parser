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
        const color = count > 0 ? pc.yellow : pc.dim;
        return `  ${pc.dim(label)}  ${color(bar)}  ${count} issues`;
    }).join('\n');
}

export function renderDiffLine(diff: CacheDiff | null): string {
    if (!diff || (diff.added === 0 && diff.fixed === 0)) return '';
    const parts: string[] = [];
    if (diff.added > 0) parts.push(pc.red(`↑ +${diff.added} new`));
    if (diff.fixed > 0) parts.push(pc.green(`↓ -${diff.fixed} fixed`));
    return `  ${parts.join('  ')}  ${pc.dim('(vs. previous scan)')}`;
}

export function printTerminalSummary(
    summary: ReportSummary,
    filesScanned: number,
    filesFromCache: number,
    diff: CacheDiff | null,
): void {
    const cacheNote = filesFromCache > 0 ? pc.dim(` (${filesFromCache} from cache)`) : '';
    console.log(`\n  Analysed ${pc.bold(String(filesScanned))} files${cacheNote}\n`);
    console.log(renderCategoryBars(summary));

    const diffLine = renderDiffLine(diff);
    if (diffLine) console.log(`\n${diffLine}`);

    const total = summary.total;
    const severityNote = summary.bySeverity.high > 0
        ? pc.red(`${total} issue${total !== 1 ? 's' : ''}`)
        : total > 0 ? pc.yellow(`${total} issue${total !== 1 ? 's' : ''}`) : pc.green('0 issues');
    console.log(`\n  Found ${severityNote} to address.\n`);
}
