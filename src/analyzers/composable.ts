import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
// @ts-ignore — CJS interop
const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
import * as t from '@babel/types';
import type { Anomaly } from '../analyzer';

export interface FileAnalysisResult {
    filePath: string;
    anomalies: Anomaly[];
}

const VUE_REACTIVITY_API = new Set([
    'ref', 'reactive', 'computed', 'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect',
    'readonly', 'shallowRef', 'shallowReactive', 'shallowReadonly', 'triggerRef', 'customRef',
    'toRef', 'toRefs', 'unref', 'markRaw', 'provide', 'inject'
]);

const VUE_LIFECYCLE_HOOKS = new Set([
    'onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount',
    'onUpdated', 'onBeforeUpdate', 'onActivated', 'onDeactivated',
    'onErrorCaptured', 'onRenderTracked', 'onRenderTriggered', 'onServerPrefetch'
]);

export function analyzeComposableFile(filePath: string, source: string): FileAnalysisResult {
    const anomalies: Anomaly[] = [];

    let ast: t.File;
    try {
        ast = babelParse(source, {
            sourceType: 'module',
            plugins: ['typescript'],
            errorRecovery: true,
        });
    } catch {
        return { filePath, anomalies };
    }

    traverse(ast, {
        ExportNamedDeclaration(exportPath: any) {
            const decl = exportPath.node.declaration;
            if (!decl) return;

            let funcNode: t.Function | null = null;
            let funcName = '';

            if (t.isFunctionDeclaration(decl) && decl.id) {
                funcName = decl.id.name;
                funcNode = decl;
            } else if (t.isVariableDeclaration(decl)) {
                for (const declarator of decl.declarations) {
                    if (
                        t.isIdentifier(declarator.id) &&
                        declarator.id.name.startsWith('use') &&
                        declarator.init &&
                        (t.isArrowFunctionExpression(declarator.init) || t.isFunctionExpression(declarator.init))
                    ) {
                        funcName = declarator.id.name;
                        funcNode = declarator.init;
                        break;
                    }
                }
            }

            if (!funcNode || !funcName.startsWith('use')) return;

            let hasReactivity = false;
            let hasLifecycle = false;
            let hasVueCallAtAll = false;

            // Traverse wewnątrz ciała funkcji
            exportPath.traverse({
                CallExpression(callPath: any) {
                    const callee = callPath.node.callee;
                    if (!t.isIdentifier(callee)) return;

                    if (VUE_REACTIVITY_API.has(callee.name)) {
                        hasReactivity = true;
                        hasVueCallAtAll = true;
                    }
                    if (VUE_LIFECYCLE_HOOKS.has(callee.name)) {
                        hasLifecycle = true;
                        hasVueCallAtAll = true;
                    }
                }
            });

            if (!hasVueCallAtAll) {
                anomalies.push({
                    code: 'COMPOSABLE_PURE_TRANSFORM',
                    severity: 'low',
                    message: `Composable '${funcName}' nie używa żadnego Vue API — to czysta transformacja danych. Przenieś do utils/ jako zwykłą funkcję.`
                });
                return;
            }

            if (!hasReactivity) {
                anomalies.push({
                    code: 'COMPOSABLE_NO_REACTIVITY',
                    severity: 'medium',
                    message: `Composable '${funcName}' nie używa reaktywności (ref/reactive/computed/watch). Sprawdź czy naprawdę potrzebuje być composable.`
                });
            }

            if (!hasLifecycle && hasReactivity) {
                anomalies.push({
                    code: 'COMPOSABLE_NO_LIFECYCLE',
                    severity: 'medium',
                    message: `Composable '${funcName}' ma reaktywność ale nie rejestruje żadnych lifecycle hooks. Upewnij się, że cleanup (onUnmounted) jest obsługiwany.`
                });
            }
        }
    });

    return { filePath, anomalies };
}
