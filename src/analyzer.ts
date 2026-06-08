import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import _traverse from '@babel/traverse';
// @ts-ignore — CJS interop: compiled binary wraps the default differently
const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
import * as t from '@babel/types';
import nodeFs from 'fs';

export interface Anomaly {
    code: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
}

export interface AnalysisResult {
    filePath: string;
    status: 'ok' | 'warning' | 'error';
    anomalies: Anomaly[];
    metrics: { totalRefs: number; unmutatedRefs: number };
}

const BROWSER_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history']);

const NON_DETERMINISTIC_CALLS = new Set(['random']);
const NON_DETERMINISTIC_OBJECTS = new Set(['Math', 'Date']);

const NUXT_VUE_AUTO_IMPORTS = new Set([
    'ref', 'reactive', 'computed', 'watch', 'watchEffect', 'readonly',
    'isRef', 'isReactive', 'isReadonly', 'toRef', 'toRefs', 'unref', 'markRaw',
    'nextTick', 'onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount',
    'onUpdated', 'onBeforeUpdate', 'defineComponent', 'defineProps', 'defineEmits',
    'defineExpose', 'shallowRef', 'shallowReactive', 'triggerRef', 'customRef',
    'provide', 'inject'
]);

const NUXT_ROUTER_AUTO_IMPORTS = new Set(['useRouter', 'useRoute', 'useLink']);

const HEAVY_COMPONENT_PATTERN = /Modal|Drawer|Dialog|Panel|Overlay|Sheet|Popover/;

function isInsideClientGuard(path: any): boolean {
    let current = path.parentPath;
    while (current) {
        // onMounted(() => { ... }) — węzeł jest wewnątrz callbacku onMounted
        if (
            t.isCallExpression(current.node) &&
            t.isIdentifier(current.node.callee) &&
            (current.node.callee.name === 'onMounted' || current.node.callee.name === 'onUnmounted')
        ) {
            return true;
        }
        // if (process.client) { ... } lub if (!process.server) { ... }
        if (t.isIfStatement(current.node)) {
            const test = current.node.test;
            if (isProcessClientCheck(test)) return true;
        }
        current = current.parentPath;
    }
    return false;
}

function isProcessClientCheck(node: t.Node): boolean {
    // process.client
    if (
        t.isMemberExpression(node) &&
        t.isIdentifier(node.object, { name: 'process' }) &&
        t.isIdentifier(node.property, { name: 'client' })
    ) return true;
    // !process.server
    if (
        t.isUnaryExpression(node) &&
        node.operator === '!' &&
        t.isMemberExpression(node.argument) &&
        t.isIdentifier(node.argument.object, { name: 'process' }) &&
        t.isIdentifier(node.argument.property, { name: 'server' })
    ) return true;
    return false;
}

function analyzeTemplate(descriptor: any, filePath: string, anomalies: Anomaly[]): void {
    if (!descriptor.template) return;

    const { ast, errors } = compileTemplate({
        source: descriptor.template.content,
        filename: filePath,
        id: 'template-analyze',
    });

    if (errors.length || !ast) return;

    function walkTemplateNode(node: any): void {
        if (!node) return;

        if (node.props) {
            for (const prop of node.props) {
                if (prop.type === 7 /* NodeTypes.DIRECTIVE */ && prop.name === 'if') {
                    const expSource: string = prop.exp?.content ?? '';
                    const isClientCheck = expSource.includes('process.client') || expSource.includes('!process.server');

                    if (isClientCheck) {
                        // Sprawdź czy rodzic ma ClientOnly lub czy jest v-else
                        const siblings: any[] = node.parent?.children ?? [];
                        const nodeIndex = siblings.indexOf(node);
                        const hasVElse = siblings.slice(nodeIndex + 1).some((s: any) =>
                            s.props?.some((p: any) => p.type === 7 && (p.name === 'else' || p.name === 'else-if'))
                        );

                        if (!hasVElse) {
                            anomalies.push({
                                code: 'HYDRATION_NO_FALLBACK',
                                severity: 'medium',
                                message: `Dyrektywa v-if="process.client" bez v-else lub fallback. SSR wyrenderuje pusty element — ryzyko hydration mismatch.`
                            });
                        }

                        anomalies.push({
                            code: 'HYDRATION_MISSING_CLIENT_ONLY',
                            severity: 'medium',
                            message: `Użycie v-if="${expSource.trim()}" zamiast komponentu <ClientOnly>. Rozważ opakowanie w <ClientOnly> dla bezpiecznego renderowania.`
                        });
                    }
                }
            }
        }

        if (node.children) {
            for (const child of node.children) {
                if (child && typeof child === 'object') {
                    child.parent = node;
                    walkTemplateNode(child);
                }
            }
        }
    }

    walkTemplateNode(ast);
}

export function analyzeVueFile(filePath: string, source: string): AnalysisResult | null {
    const { descriptor, errors } = parse(source);

    if (errors.length || !descriptor.scriptSetup) {
        return null;
    }

    let script;
    try {
        script = compileScript(descriptor, {
            id: 'analyze-id',
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

    const isPageFile = filePath.includes('/pages/');

    const declaredRefs: string[] = [];
    const mutatedRefs = new Set<string>();
    const anomalies: Anomaly[] = [];

    let hasDefinePageMeta = false;
    let hasSeoMeta = false;
    const detectedBrowserGlobals = new Set<string>();
    const detectedNonDeterministic = new Set<string>();

    // @ts-ignore
    traverse(t.file(t.program(ast)), {
        // --- Istniejąca reguła: UNUSED_DEEP_REACTIVITY ---
        VariableDeclarator(path: any) {
            if (
                t.isIdentifier(path.node.id) &&
                t.isCallExpression(path.node.init) &&
                t.isIdentifier(path.node.init.callee) &&
                path.node.init.callee.name === 'ref'
            ) {
                declaredRefs.push(path.node.id.name);
            }
        },
        AssignmentExpression(path: any) {
            if (
                t.isMemberExpression(path.node.left) &&
                t.isIdentifier(path.node.left.property) &&
                path.node.left.property.name === 'value'
            ) {
                mutatedRefs.add(path.node.left.object.name);
            }
        },
        UpdateExpression(path: any) {
            if (
                t.isMemberExpression(path.node.argument) &&
                t.isIdentifier(path.node.argument.property) &&
                path.node.argument.property.name === 'value'
            ) {
                mutatedRefs.add(path.node.argument.object.name);
            }
        },

        // --- HYDRATION_BROWSER_GLOBAL ---
        MemberExpression(path: any) {
            if (
                t.isIdentifier(path.node.object) &&
                BROWSER_GLOBALS.has(path.node.object.name) &&
                !isInsideClientGuard(path) &&
                !detectedBrowserGlobals.has(path.node.object.name)
            ) {
                detectedBrowserGlobals.add(path.node.object.name);
                anomalies.push({
                    code: 'HYDRATION_BROWSER_GLOBAL',
                    severity: 'high',
                    message: `Dostęp do '${path.node.object.name}' poza onMounted lub process.client guard. Spowoduje hydration mismatch w SSR.`
                });
            }
        },

        // --- HYDRATION_NON_DETERMINISTIC + PINIA/SEO CallExpression ---
        CallExpression(path: any) {
            const callee = path.node.callee;

            // Math.random() / Date.now()
            if (
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.object) &&
                NON_DETERMINISTIC_OBJECTS.has(callee.object.name) &&
                t.isIdentifier(callee.property) &&
                (NON_DETERMINISTIC_CALLS.has(callee.property.name) || callee.property.name === 'now')
            ) {
                const key = `${callee.object.name}.${callee.property.name}`;
                if (!detectedNonDeterministic.has(key)) {
                    detectedNonDeterministic.add(key);
                    anomalies.push({
                        code: 'HYDRATION_NON_DETERMINISTIC',
                        severity: 'high',
                        message: `Wywołanie '${key}()' generuje różne wartości na serwerze i kliencie — ryzyko hydration mismatch.`
                    });
                }
            }

            // definePageMeta — SEO check
            if (t.isIdentifier(callee) && callee.name === 'definePageMeta') {
                hasDefinePageMeta = true;
            }

            // useSeoMeta / useHead — SEO check
            if (t.isIdentifier(callee) && (callee.name === 'useSeoMeta' || callee.name === 'useHead')) {
                hasSeoMeta = true;
            }
        },

        // --- HYDRATION_NON_DETERMINISTIC: new Date() ---
        NewExpression(path: any) {
            if (t.isIdentifier(path.node.callee) && path.node.callee.name === 'Date') {
                if (!detectedNonDeterministic.has('new Date')) {
                    detectedNonDeterministic.add('new Date');
                    anomalies.push({
                        code: 'HYDRATION_NON_DETERMINISTIC',
                        severity: 'high',
                        message: `'new Date()' generuje różne wartości na serwerze i kliencie — ryzyko hydration mismatch.`
                    });
                }
            }
        },

        // --- NUXT_MANUAL_IMPORT + NUXT_MISSING_ASYNC_COMPONENT ---
        ImportDeclaration(path: any) {
            const source = path.node.source.value;

            // Auto-imports check
            if (source === 'vue' || source === 'vue-router') {
                const autoImports = source === 'vue' ? NUXT_VUE_AUTO_IMPORTS : NUXT_ROUTER_AUTO_IMPORTS;
                const manuallyImported = path.node.specifiers
                    .filter((s: any) => t.isImportSpecifier(s) && autoImports.has((s.imported as t.Identifier).name))
                    .map((s: any) => (s.imported as t.Identifier).name);

                if (manuallyImported.length > 0) {
                    anomalies.push({
                        code: 'NUXT_MANUAL_IMPORT',
                        severity: 'low',
                        message: `Zbędny import z '${source}': { ${manuallyImported.join(', ')} } — Nuxt 4 auto-importuje te symbole.`
                    });
                }
            }

            // Lazy loading check — synchroniczny import ciężkich komponentów
            for (const specifier of path.node.specifiers) {
                if (t.isImportDefaultSpecifier(specifier)) {
                    const name: string = specifier.local.name;
                    if (HEAVY_COMPONENT_PATTERN.test(name)) {
                        anomalies.push({
                            code: 'NUXT_MISSING_ASYNC_COMPONENT',
                            severity: 'low',
                            message: `Komponent '${name}' jest importowany synchronicznie. Rozważ defineAsyncComponent(() => import('...')) dla lepszego code-splitting.`
                        });
                    }
                }
            }
        }
    });

    // --- Post-traverse: UNUSED_DEEP_REACTIVITY ---
    for (const refName of declaredRefs) {
        if (!mutatedRefs.has(refName)) {
            anomalies.push({
                code: 'UNUSED_DEEP_REACTIVITY',
                severity: 'medium',
                message: `Zmienna '${refName}' jest ref(), ale jej wartość (.value) nie jest mutowana. Zmień na const lub shallowRef().`
            });
        }
    }

    // --- Post-traverse: SEO rules (tylko pages/) ---
    if (isPageFile) {
        if (!hasDefinePageMeta) {
            anomalies.push({
                code: 'NUXT_MISSING_PAGE_META',
                severity: 'medium',
                message: `Strona nie zawiera definePageMeta(). Zdefiniuj meta dane strony (title, layout, middleware) dla poprawnego SEO i routingu.`
            });
        }
        if (!hasSeoMeta) {
            anomalies.push({
                code: 'NUXT_MISSING_SEO_META',
                severity: 'low',
                message: `Strona nie zawiera useSeoMeta() ani useHead(). Dodaj meta tagi (title, description, og:image) dla SEO.`
            });
        }
    }

    // --- Template analysis: HYDRATION_MISSING_CLIENT_ONLY + HYDRATION_NO_FALLBACK ---
    analyzeTemplate(descriptor, filePath, anomalies);

    return {
        filePath,
        status: anomalies.length > 0 ? 'warning' : 'ok',
        anomalies,
        metrics: {
            totalRefs: declaredRefs.length,
            unmutatedRefs: declaredRefs.length - mutatedRefs.size
        }
    };
}
