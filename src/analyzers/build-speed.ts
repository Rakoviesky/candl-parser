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

const HEAVY_LIBRARIES = new Set([
    // Oryginalne
    'lodash', 'moment', 'rxjs', 'date-fns', 'ramda', 'three', 'chart.js',
    // UI Frameworks
    'vuetify', 'quasar', 'naive-ui', '@arco-design/web-vue', 'vant',
    'primevue', 'element-plus', 'ant-design-vue',
    // Utilities
    'underscore', 'fp-ts', 'effect', 'zod', 'yup', 'valibot', 'joi',
    'class-validator', 'class-transformer',
    // Data / State
    'axios', 'pinia', '@tanstack/vue-query', 'swr',
]);

function extractScriptSource(filePath: string, source: string): string | null {
    if (filePath.endsWith('.vue')) {
        const { descriptor } = parseSFC(source);
        return descriptor.scriptSetup?.content ?? descriptor.script?.content ?? null;
    }
    return source;
}

function resolveImportPath(importSrc: string, fromFile: string): string | null {
    if (!importSrc.startsWith('./') && !importSrc.startsWith('../')) return null;

    const base = path.resolve(path.dirname(fromFile), importSrc);
    if (fs.existsSync(base)) return base;

    for (const ext of ['.ts', '.vue', '/index.ts', '.js', '/index.js']) {
        const candidate = base + ext;
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

function getPackageName(src: string): string {
    const parts = src.split('/');
    if (src.startsWith('@') && parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
    }
    return parts[0] ?? src;
}

interface FileAnalysisData {
    resolvedImports: string[];
    heavyAnomalies: Anomaly[];
}

function analyzeFileImports(filePath: string, fileSet: Set<string>): FileAnalysisData {
    const resolvedImports: string[] = [];
    const heavyAnomalies: Anomaly[] = [];

    let source: string;
    try {
        source = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return { resolvedImports, heavyAnomalies };
    }

    const code = extractScriptSource(filePath, source);
    if (!code) return { resolvedImports, heavyAnomalies };

    let ast: t.File;
    try {
        ast = babelParse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
            errorRecovery: true,
        });
    } catch {
        return { resolvedImports, heavyAnomalies };
    }

    traverse(ast, {
        ImportDeclaration(nodePath: any) {
            const src: string = nodePath.node.source.value;
            const specifiers: any[] = nodePath.node.specifiers;

            // Dependency graph: only relative imports pointing to project files
            const resolved = resolveImportPath(src, filePath);
            if (resolved && fileSet.has(resolved)) {
                resolvedImports.push(resolved);
            }

            // Heavy sync import detection
            const pkg = getPackageName(src);
            if (HEAVY_LIBRARIES.has(pkg)) {
                const hasDefault = specifiers.some((s: any) => t.isImportDefaultSpecifier(s));
                const hasNamespace = specifiers.some((s: any) => t.isImportNamespaceSpecifier(s));

                if (hasDefault || hasNamespace) {
                    const importStyle = hasNamespace ? 'wildcard' : 'default';
                    heavyAnomalies.push({
                        code: 'BUILD_HEAVY_SYNC_IMPORT',
                        severity: 'medium',
                        message: `Heavy library "${pkg}" imported via ${importStyle} import — will bloat the bundle. Use named imports: import { ... } from '${pkg}'.`,
                    });
                }
            }
        },
    });

    return { resolvedImports, heavyAnomalies };
}

function detectCircularDependencies(graph: Map<string, Set<string>>): FileAnalysisResult[] {
    const results: FileAnalysisResult[] = [];
    const globalVisited = new Set<string>();
    const reportedCycles = new Set<string>();

    for (const startNode of graph.keys()) {
        if (globalVisited.has(startNode)) continue;

        const pathSet = new Set<string>();
        const pathArr: string[] = [];
        const stack: Array<{ node: string; children: IterableIterator<string> }> = [];

        pathSet.add(startNode);
        pathArr.push(startNode);
        stack.push({ node: startNode, children: (graph.get(startNode) ?? new Set()).values() });

        while (stack.length > 0) {
            // stack.length > 0 guarantees top is defined
            const top = stack[stack.length - 1]!;
            const { value: child, done } = top.children.next();

            if (done) {
                pathSet.delete(top.node);
                pathArr.pop();
                globalVisited.add(top.node);
                stack.pop();
                continue;
            }

            if (!graph.has(child) || globalVisited.has(child)) continue;

            if (pathSet.has(child)) {
                const cycleStart = pathArr.indexOf(child);
                const cyclePath = [...pathArr.slice(cycleStart), child];
                const cycleKey = [...cyclePath].sort().join('|');

                if (!reportedCycles.has(cycleKey)) {
                    reportedCycles.add(cycleKey);
                    const shortPath = cyclePath
                        .map(p => path.relative(process.cwd(), p))
                        .join(' → ');
                    results.push({
                        filePath: child,
                        anomalies: [{
                            code: 'BUILD_CIRCULAR_DEPENDENCY',
                            severity: 'high',
                            message: `Circular dependency: ${shortPath}`,
                        }],
                    });
                }
                continue;
            }

            pathSet.add(child);
            pathArr.push(child);
            stack.push({ node: child, children: (graph.get(child) ?? new Set()).values() });
        }
    }

    return results;
}

function detectDuplicateImportSpread(
    graph: Map<string, Set<string>>,
    fileSet: Set<string>,
): FileAnalysisResult[] {
    const importerCount = new Map<string, number>();

    for (const imports of graph.values()) {
        for (const imported of imports) {
            importerCount.set(imported, (importerCount.get(imported) ?? 0) + 1);
        }
    }

    const results: FileAnalysisResult[] = [];
    const THRESHOLD = 5;

    for (const [module, count] of importerCount) {
        if (count >= THRESHOLD && fileSet.has(module)) {
            const shortPath = path.relative(process.cwd(), module);
            results.push({
                filePath: module,
                anomalies: [{
                    code: 'BUILD_DUPLICATE_IMPORT_SPREAD',
                    severity: 'low',
                    message: `Module imported in ${count} files — consider a Nuxt plugin or singleton composable for better code-splitting.`,
                }],
            });
        }
    }

    return results;
}

export function analyzeBuildSpeed(files: string[]): FileAnalysisResult[] {
    const fileSet = new Set(files);
    const graph = new Map<string, Set<string>>();
    const heavyResults: FileAnalysisResult[] = [];

    // Single pass per file: build dep graph + collect heavy import issues
    for (const filePath of files) {
        const { resolvedImports, heavyAnomalies } = analyzeFileImports(filePath, fileSet);
        graph.set(filePath, new Set(resolvedImports));
        if (heavyAnomalies.length > 0) {
            heavyResults.push({ filePath, anomalies: heavyAnomalies });
        }
    }

    return [
        ...detectCircularDependencies(graph),
        ...heavyResults,
        ...detectDuplicateImportSpread(graph, fileSet),
    ];
}
