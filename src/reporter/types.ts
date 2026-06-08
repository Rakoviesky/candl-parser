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
