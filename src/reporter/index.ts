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
