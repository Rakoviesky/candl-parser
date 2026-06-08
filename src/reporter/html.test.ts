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
