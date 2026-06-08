import type { FileAnalysisResult } from '../analyzers/composable';
import { buildSummary, type ReportData, type ReportIssue } from './types';

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
    Bun.write(outputPath, serializeReport(data));
}
