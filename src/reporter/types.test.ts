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
