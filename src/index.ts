import { intro, outro, spinner, select, note,text } from '@clack/prompts';
import pc from 'picocolors';
import fs from 'fs';
import path from 'path';
import { findVueFiles, findComposableFiles, findStoreFiles, findTypeScriptFiles } from './scanner';
import { analyzeVueFile, type AnalysisResult } from './analyzer';
import { analyzeComposableFile, type FileAnalysisResult } from './analyzers/composable';
import { analyzePiniaProject } from './analyzers/pinia';
import { analyzeIsland } from './analyzers/island';
import { analyzeTreeShaking } from './analyzers/tree-shaking';
import { analyzeBuildSpeed } from './analyzers/build-speed';

async function main() {
    console.clear();

    intro(pc.bgRed(pc.black('🕯️ Candl-Parser v0.1.0 ')));

    let target = await select({
        message: 'Wybierz katalog do analizy architektonicznej:',
        options: [
            { value: '.', label: 'Cały obecny projekt (ROOT)' },
            { value: 'custom', label: 'Wpisz własny katalog', hint: 'np. ./src/components' },
            { value: './components', label: 'Tylko folder /components' },
            { value: './pages', label: 'Tylko folder /pages' },
        ],
    });

    if (typeof target !== 'string') return;

    if (target === 'custom') {
        const customPath = await text({
            message: 'Podaj relatywną ścieżkę do projektu:',
            placeholder: 'np. apps/vehis-pl lub ./packages/ui',
            initialValue: '.',
        });

        if (typeof customPath !== 'string') {
            process.exit(0);
        }
        // @ts-ignore
        target = customPath;
    }


    // @ts-ignore
    const targetPath = path.resolve(process.cwd(), target);

    // 3. Odpalenie pięknego spinnera ładowania
    const s = spinner();
    // @ts-ignore
    s.start(`Skanowanie katalogu: ${pc.cyan(target)} ...`);

    // Sztuczne opóźnienie (opcjonalne, tylko żeby użytkownik zdążył zobaczyć ładny spinner)
    await new Promise(resolve => setTimeout(resolve, 800));

    let vueFiles: string[];
    try {
        vueFiles = findVueFiles(targetPath);
    } catch (e) {
        s.stop(pc.red('Nie znaleziono katalogu! Upewnij się, że jesteś w projekcie Nuxt/Vue.'));
        process.exit(1);
    }

    if (vueFiles.length === 0) {
        s.stop(pc.yellow('Nie znaleziono żadnych plików .vue do analizy.'));
        process.exit(0);
    }

    // 4. Analiza każdego pliku .vue
    const results: AnalysisResult[] = [];
    const islandResults: FileAnalysisResult[] = [];
    for (const file of vueFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const res = analyzeVueFile(file, content);
        if (res && res.status !== 'ok') {
            results.push(res);
        }
        const islandRes = analyzeIsland(file, content);
        if (islandRes.anomalies.length > 0) islandResults.push(islandRes);
    }

    // 4b. Analiza composables
    const composableFiles = findComposableFiles(targetPath);
    const composableResults: FileAnalysisResult[] = [];
    for (const file of composableFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const res = analyzeComposableFile(file, content);
        if (res.anomalies.length > 0) composableResults.push(res);
    }

    // 4c. Analiza Pinia stores (cross-file)
    const storeFiles = findStoreFiles(targetPath);
    const allProjectFiles = [...vueFiles, ...composableFiles, ...storeFiles];
    const piniaResults: FileAnalysisResult[] = analyzePiniaProject(storeFiles, allProjectFiles);

    // 4d. Analiza tree-shakingu (Vue + TS)
    const tsFiles = findTypeScriptFiles(targetPath);
    const allFilesForPerf = [...vueFiles, ...tsFiles];
    const treeShakingResults: FileAnalysisResult[] = analyzeTreeShaking(allFilesForPerf);

    // 4e. Wykrywanie wąskich gardeł buildu (cross-file)
    const buildSpeedResults: FileAnalysisResult[] = analyzeBuildSpeed(allFilesForPerf);

    s.stop(`Przeanalizowano ${pc.bold(vueFiles.length)} plików .vue, ${pc.bold(composableFiles.length)} composables, ${pc.bold(storeFiles.length)} stores, ${pc.bold(tsFiles.length)} plików .ts.`);

    // 5. Wyświetlanie wyników
    const allResults: FileAnalysisResult[] = [
        ...results,
        ...islandResults,
        ...composableResults,
        ...piniaResults,
        ...treeShakingResults,
        ...buildSpeedResults,
    ];

    if (allResults.length === 0) {
        outro(pc.green('🎉 Idealna architektura! Nie znaleziono problemów w projekcie.'));
    } else {
        let issuesCount = 0;

        allResults.forEach(result => {
            const relativePath = path.relative(process.cwd(), result.filePath);

            let message = '';
            result.anomalies.forEach(anomaly => {
                issuesCount++;
                const icon = anomaly.severity === 'high' ? pc.red('▲') : anomaly.severity === 'medium' ? pc.yellow('■') : pc.dim('○');
                message += `${icon} [${anomaly.code}] ${anomaly.message}\n`;
            });

            note(message.trim(), pc.yellow(`Plik: ${relativePath}`));
        });

        const treeShakingCount = treeShakingResults.reduce((n, r) => n + r.anomalies.length, 0);
        const buildSpeedCount = buildSpeedResults.reduce((n, r) => n + r.anomalies.length, 0);

        outro(
            pc.red(`Znaleziono ${issuesCount} problemów do optymalizacji. Czas na refactoring!`) +
            `\n  ${pc.dim('Tree-shaking issues:')} ${treeShakingCount > 0 ? pc.yellow(String(treeShakingCount)) : pc.green('0')}` +
            `\n  ${pc.dim('Build bottlenecks:  ')} ${buildSpeedCount > 0 ? pc.yellow(String(buildSpeedCount)) : pc.green('0')}`
        );
    }
}

main().catch(console.error);