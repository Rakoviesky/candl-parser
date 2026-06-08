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
        if (loaded !== null) {
            const fileResult = loaded.results['a.ts'];
            expect(fileResult).toBeDefined();
            if (fileResult && fileResult.anomalies[0]) {
                expect(fileResult.anomalies[0].code).toBe('BUILD_X');
            }
            expect(loaded.lastReport.totalIssues).toBe(1);
        }
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
