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
