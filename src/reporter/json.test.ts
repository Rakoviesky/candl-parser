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
