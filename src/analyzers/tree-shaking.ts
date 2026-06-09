import { parse as parseSFC } from '@vue/compiler-sfc';
import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
// @ts-ignore — CJS interop
const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
import * as t from '@babel/types';
import fs from 'fs';
import path from 'path';
import type { Anomaly } from '../analyzer';
import type { FileAnalysisResult } from './composable';

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.stylus']);

function extractScriptSource(filePath: string, source: string): string | null {
    if (filePath.endsWith('.vue')) {
        const { descriptor } = parseSFC(source);
        return descriptor.scriptSetup?.content ?? descriptor.script?.content ?? null;
    }
    return source;
}

function isInPluginsDir(filePath: string): boolean {
    return filePath.includes(`${path.sep}plugins${path.sep}`) || filePath.includes('/plugins/');
}

function isBarrelFile(filePath: string): boolean {
    return path.basename(filePath, '.ts') === 'index';
}

function analyzeFileForTreeShaking(filePath: string, source: string): Anomaly[] {
    const anomalies: Anomaly[] = [];

    const code = extractScriptSource(filePath, source);
    if (!code) return anomalies;

    let ast: t.File;
    try {
        ast = babelParse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
            errorRecovery: true,
        });
    } catch {
        return anomalies;
    }

    const inPlugins = isInPluginsDir(filePath);
    const barrel = isBarrelFile(filePath);
    let barrelExportCount = 0;

    traverse(ast, {
        ExportAllDeclaration() {
            if (barrel) barrelExportCount++;
        },
        ImportDeclaration(nodePath: any) {
            const src: string = nodePath.node.source.value;
            const specifiers: any[] = nodePath.node.specifiers;

            const hasNamespace = specifiers.some((s: any) => t.isImportNamespaceSpecifier(s));
            if (hasNamespace) {
                anomalies.push({
                    code: 'TREESHAKE_WILDCARD_IMPORT',
                    severity: 'medium',
                    message: `Wildcard import "import * as X from '${src}'" prevents tree-shaking — use named imports instead.`,
                });
            }

            const isStyleFile = STYLE_EXTENSIONS.has(path.extname(src));
            if (specifiers.length === 0 && !isStyleFile && !inPlugins) {
                anomalies.push({
                    code: 'TREESHAKE_SIDE_EFFECT_IMPORT',
                    severity: 'low',
                    message: `Side-effect import "import '${src}'" may block tree-shaking — move to plugins/ or add "sideEffects": false in package.json.`,
                });
            }
        },
    });

    if (barrel && barrelExportCount > 0) {
        anomalies.unshift({
            code: 'TREESHAKE_BARREL_FILE',
            severity: 'medium',
            message: `Barrel file with ${barrelExportCount} "export * from" — hurts tree-shaking in Vite/Rollup. Use named re-exports: export { X } from '...'.`,
        });
    }

    return anomalies;
}

export function analyzeTreeShaking(files: string[]): FileAnalysisResult[] {
    const results: FileAnalysisResult[] = [];

    for (const filePath of files) {
        let source: string;
        try {
            source = fs.readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }

        const anomalies = analyzeFileForTreeShaking(filePath, source);
        if (anomalies.length > 0) {
            results.push({ filePath, anomalies });
        }
    }

    return results;
}
