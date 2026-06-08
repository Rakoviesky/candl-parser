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
            bySeverity[issue.severity as 'high' | 'medium' | 'low']++;
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
