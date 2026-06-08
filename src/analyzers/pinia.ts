import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
// @ts-ignore — CJS interop
const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
import * as t from '@babel/types';
import fs from 'fs';
import type { Anomaly } from '../analyzer';
import type { FileAnalysisResult } from './composable';

interface StoreInfo {
    storeId: string;
    filePath: string;
    hasState: boolean;
    hasGetters: boolean;
    hasActionsOnly: boolean;
    consumerCount: number;
}

const VUE_REACTIVITY = new Set(['ref', 'reactive', 'computed', 'shallowRef', 'shallowReactive']);

function parseFile(source: string): t.File | null {
    try {
        return babelParse(source, {
            sourceType: 'module',
            plugins: ['typescript'],
            errorRecovery: true,
        });
    } catch {
        return null;
    }
}

function collectStoreDefinitions(storeFiles: string[]): Map<string, StoreInfo> {
    const stores = new Map<string, StoreInfo>();

    for (const filePath of storeFiles) {
        let source: string;
        try {
            source = fs.readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }

        const ast = parseFile(source);
        if (!ast) continue;

        traverse(ast, {
            CallExpression(path: any) {
                const callee = path.node.callee;
                if (!t.isIdentifier(callee) || callee.name !== 'defineStore') return;

                const args = path.node.arguments;
                if (args.length < 2) return;

                const idArg = args[0];
                const storeId = t.isStringLiteral(idArg) ? idArg.value : null;
                if (!storeId) return;

                const secondArg = args[1];
                let hasState = false;
                let hasGetters = false;
                let hasActionsOnly = false;

                if (t.isObjectExpression(secondArg)) {
                    // Options store syntax
                    const propNames = secondArg.properties
                        .filter((p): p is t.ObjectProperty | t.ObjectMethod =>
                            t.isObjectProperty(p) || t.isObjectMethod(p)
                        )
                        .map(p => (t.isIdentifier(p.key) ? p.key.name : ''));

                    hasState = propNames.includes('state');
                    hasGetters = propNames.includes('getters');
                    const hasActions = propNames.includes('actions');
                    hasActionsOnly = hasActions && !hasState && !hasGetters;

                    // Sprawdź czy state() zwraca pusty obiekt
                    if (hasState) {
                        const stateProp = secondArg.properties.find(
                            p => (t.isObjectProperty(p) || t.isObjectMethod(p)) && t.isIdentifier(p.key) && p.key.name === 'state'
                        );
                        if (stateProp && t.isObjectProperty(stateProp)) {
                            const stateVal = stateProp.value;
                            if (
                                (t.isArrowFunctionExpression(stateVal) || t.isFunctionExpression(stateVal)) &&
                                t.isObjectExpression(stateVal.body as t.Node) &&
                                (stateVal.body as t.ObjectExpression).properties.length === 0
                            ) {
                                hasState = false;
                            }
                        }
                    }
                } else if (t.isArrowFunctionExpression(secondArg) || t.isFunctionExpression(secondArg)) {
                    // Setup store syntax — sprawdź czy używa Vue reactivity
                    let usesReactivity = false;
                    path.traverse({
                        CallExpression(innerPath: any) {
                            if (
                                t.isIdentifier(innerPath.node.callee) &&
                                VUE_REACTIVITY.has(innerPath.node.callee.name)
                            ) {
                                usesReactivity = true;
                            }
                        }
                    });
                    hasState = usesReactivity;
                    hasActionsOnly = !usesReactivity;
                }

                stores.set(storeId, {
                    storeId,
                    filePath,
                    hasState,
                    hasGetters,
                    hasActionsOnly,
                    consumerCount: 0,
                });
            }
        });
    }

    return stores;
}

function countStoreUsages(allFiles: string[], stores: Map<string, StoreInfo>): void {
    // Zbieramy nazwy use*Store funkcji z id store'ów
    // Pinia konwencja: storeId 'user' → useUserStore(), 'auth' → useAuthStore()
    // Szukamy wywołań funkcji kończących się 'Store'
    const storeIdToKey = new Map<string, string>();
    for (const [storeId, info] of stores) {
        // Normalizacja: 'my-store' → 'useMyStoreStore', 'user' → 'useUserStore'
        const camel = storeId.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const expectedFn = `use${camel.charAt(0).toUpperCase()}${camel.slice(1)}Store`;
        storeIdToKey.set(expectedFn, storeId);
    }

    for (const filePath of allFiles) {
        let source: string;
        try {
            source = fs.readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }

        const ast = parseFile(source);
        if (!ast) continue;

        traverse(ast, {
            CallExpression(path: any) {
                const callee = path.node.callee;
                if (!t.isIdentifier(callee)) return;

                const fnName = callee.name;
                if (!fnName.endsWith('Store') || !fnName.startsWith('use')) return;

                // Sprawdź bezpośrednie dopasowanie po nazwie funkcji
                const matchedId = storeIdToKey.get(fnName);
                if (matchedId) {
                    const store = stores.get(matchedId);
                    if (store) store.consumerCount++;
                } else {
                    // Fallback: dopasuj po pliku store (useXxxStore → szukaj w nazwie pliku)
                    for (const [storeId, store] of stores) {
                        const normalizedId = storeId.replace(/-/g, '').toLowerCase();
                        const normalizedFn = fnName.replace('use', '').replace('Store', '').toLowerCase();
                        if (normalizedFn === normalizedId) {
                            store.consumerCount++;
                        }
                    }
                }
            }
        });
    }
}

export function analyzePiniaProject(
    storeFiles: string[],
    allFiles: string[]
): FileAnalysisResult[] {
    if (storeFiles.length === 0) return [];

    const stores = collectStoreDefinitions(storeFiles);
    if (stores.size === 0) return [];

    countStoreUsages(allFiles, stores);

    const results: FileAnalysisResult[] = [];

    for (const [, store] of stores) {
        const anomalies: Anomaly[] = [];

        if (store.consumerCount === 0) {
            anomalies.push({
                code: 'PINIA_UNUSED_STORE',
                severity: 'high',
                message: `Store '${store.storeId}' nie jest używany w żadnym pliku projektu. Rozważ usunięcie.`
            });
        } else if (store.consumerCount === 1) {
            anomalies.push({
                code: 'PINIA_SINGLE_CONSUMER',
                severity: 'low',
                message: `Store '${store.storeId}' jest używany tylko w 1 miejscu. Rozważ przeniesienie logiki do lokalnego composable.`
            });
        }

        if (store.hasActionsOnly) {
            anomalies.push({
                code: store.hasState === false && store.hasGetters === false
                    ? 'PINIA_SHOULD_BE_UTILITY'
                    : 'PINIA_NO_STATE',
                severity: 'medium',
                message: `Store '${store.storeId}' nie zawiera reaktywnego stanu — tylko akcje. Przenieś do zwykłego modułu utility lub composable.`
            });
        } else if (!store.hasState) {
            anomalies.push({
                code: 'PINIA_NO_STATE',
                severity: 'medium',
                message: `Store '${store.storeId}' nie ma reaktywnego stanu. Sprawdź czy użycie Pinia jest uzasadnione.`
            });
        }

        if (anomalies.length > 0) {
            results.push({ filePath: store.filePath, anomalies });
        }
    }

    return results;
}
