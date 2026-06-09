import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import _traverse from '@babel/traverse';
// @ts-ignore — CJS interop
const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
import * as t from '@babel/types';
import nodeFs from 'fs';
import type { Anomaly } from '../analyzer';
import type { FileAnalysisResult } from './composable';

const CLIENT_REACTIVE_API = new Set([
    'ref', 'reactive', 'shallowRef', 'shallowReactive', 'useState',
]);

const CLIENT_LIFECYCLE_HOOKS = new Set([
    'onMounted', 'onUnmounted', 'onBeforeUnmount', 'onUpdated', 'onBeforeUpdate',
    'onActivated', 'onDeactivated',
]);

const SERVER_DATA_API = new Set(['useAsyncData', 'useFetch', 'useLazyAsyncData', 'useLazyFetch']);

const INTERACTIVE_EVENTS = new Set([
    'click', 'submit', 'change', 'input', 'keydown', 'keyup', 'keypress',
    'mousedown', 'mouseup', 'mouseover', 'mouseleave', 'mouseenter', 'mousemove',
    'touchstart', 'touchend', 'touchmove',
    'focus', 'blur', 'focusin', 'focusout',
    'dblclick', 'contextmenu', 'wheel', 'drag', 'drop',
]);

interface ScriptAnalysis {
    hasClientReactivity: boolean;
    hasClientLifecycle: boolean;
    hasServerData: boolean;
    reactiveNames: string[];
    lifecycleNames: string[];
}

interface TemplateAnalysis {
    hasInteractiveHandlers: boolean;
    handlerNames: string[];
}

function analyzeScript(descriptor: any, filePath: string): ScriptAnalysis | null {
    if (!descriptor.scriptSetup) return null;

    let script;
    try {
        script = compileScript(descriptor, {
            id: 'island-analyze',
            fs: {
                fileExists: (f: string) => nodeFs.existsSync(f),
                readFile: (f: string) => { try { return nodeFs.readFileSync(f, 'utf-8'); } catch { return undefined; } },
            },
        });
    } catch {
        return null;
    }

    const ast = script.scriptSetupAst;
    if (!ast) return null;

    const result: ScriptAnalysis = {
        hasClientReactivity: false,
        hasClientLifecycle: false,
        hasServerData: false,
        reactiveNames: [],
        lifecycleNames: [],
    };

    // @ts-ignore
    traverse(t.file(t.program(ast)), {
        CallExpression(path: any) {
            const callee = path.node.callee;
            if (!t.isIdentifier(callee)) return;

            if (CLIENT_REACTIVE_API.has(callee.name)) {
                result.hasClientReactivity = true;
                if (!result.reactiveNames.includes(callee.name)) {
                    result.reactiveNames.push(callee.name);
                }
            }
            if (CLIENT_LIFECYCLE_HOOKS.has(callee.name)) {
                result.hasClientLifecycle = true;
                if (!result.lifecycleNames.includes(callee.name)) {
                    result.lifecycleNames.push(callee.name);
                }
            }
            if (SERVER_DATA_API.has(callee.name)) {
                result.hasServerData = true;
            }
        }
    });

    return result;
}

function analyzeTemplateForEvents(descriptor: any, filePath: string): TemplateAnalysis {
    const result: TemplateAnalysis = { hasInteractiveHandlers: false, handlerNames: [] };

    if (!descriptor.template) return result;

    const { ast, errors } = compileTemplate({
        source: descriptor.template.content,
        filename: filePath,
        id: 'island-template',
    });

    if (errors.length || !ast) return result;

    function walk(node: any): void {
        if (!node) return;

        if (node.props) {
            for (const prop of node.props) {
                // v-on directives: type=7 (DIRECTIVE), name='on'
                if (prop.type === 7 && prop.name === 'on' && prop.arg) {
                    const eventName: string = prop.arg.content ?? '';
                    // Pomijamy @vue:* (lifecycle Nuxt) i @update:* (v-model emits)
                    if (
                        !eventName.startsWith('vue:') &&
                        !eventName.startsWith('update:') &&
                        INTERACTIVE_EVENTS.has(eventName)
                    ) {
                        result.hasInteractiveHandlers = true;
                        if (!result.handlerNames.includes(eventName)) {
                            result.handlerNames.push(eventName);
                        }
                    }
                }
            }
        }

        for (const child of node.children ?? []) {
            if (child && typeof child === 'object') walk(child);
        }
    }

    walk(ast);
    return result;
}

export function analyzeIsland(filePath: string, source: string): FileAnalysisResult {
    const anomalies: Anomaly[] = [];
    const isIslandFile = filePath.endsWith('.island.vue');

    const { descriptor, errors } = parse(source);
    if (errors.length || !descriptor.scriptSetup) {
        return { filePath, anomalies };
    }

    const scriptAnalysis = analyzeScript(descriptor, filePath);
    const templateAnalysis = analyzeTemplateForEvents(descriptor, filePath);

    if (isIslandFile) {
        // --- Walidacja .island.vue ---
        if (scriptAnalysis?.hasClientReactivity) {
            anomalies.push({
                code: 'ISLAND_MISUSE',
                severity: 'high',
                message: `Island uses reactive state (${scriptAnalysis.reactiveNames.join(', ')}) — Nuxt islands are server-only and do not support client-side reactivity.`,
            });
        }
        if (scriptAnalysis?.hasClientLifecycle) {
            anomalies.push({
                code: 'ISLAND_MISUSE',
                severity: 'high',
                message: `Island uses lifecycle hooks (${scriptAnalysis.lifecycleNames.join(', ')}) — these are never called in server-only islands.`,
            });
        }
        if (templateAnalysis.hasInteractiveHandlers) {
            anomalies.push({
                code: 'ISLAND_MISUSE',
                severity: 'high',
                message: `Island has interactive event handlers (@${templateAnalysis.handlerNames.join(', @')}) — islands are server-only, events won't fire on the client.`,
            });
        }
    } else {
        // --- Detekcja kandydata na wyspę ---
        if (!scriptAnalysis) return { filePath, anomalies };

        const noReactivity = !scriptAnalysis.hasClientReactivity;
        const noLifecycle = !scriptAnalysis.hasClientLifecycle;
        const noInteraction = !templateAnalysis.hasInteractiveHandlers;

        if (noReactivity && noLifecycle && noInteraction) {
            const hasServerData = scriptAnalysis.hasServerData;
            const extra = hasServerData
                ? ' Component fetches data via useAsyncData/useFetch — a particularly good island candidate.'
                : '';

            anomalies.push({
                code: 'ISLAND_CANDIDATE',
                severity: 'low',
                message: `Component has no reactivity, lifecycle hooks or interactive event handlers — consider converting to *.island.vue (server component) for better performance.${extra}`,
            });
        }
    }

    return { filePath, anomalies };
}
