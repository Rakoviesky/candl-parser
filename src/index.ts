import { intro, spinner, select, note, text } from '@clack/prompts';
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
import { buildReportData } from './reporter/json';
import { runReporter } from './reporter/index';
import { getCategoryForCode } from './reporter/types';
import { getChangedFiles, buildHashSnapshot, type FileHashCache } from './cache/file-hash';
import { loadReportStore, saveReportStore, diffReports, buildLastReport, type StoredResults } from './cache/report-store';

async function main() {
    console.clear();

    intro(pc.bgRed(pc.black('🕯️ Candl-Parser v0.2.0 ')));

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
        if (typeof customPath !== 'string') process.exit(0);
        // @ts-ignore
        target = customPath;
    }

    // @ts-ignore
    const targetPath = path.resolve(process.cwd(), target);
    const cacheDir = path.join(targetPath, '.candl-cache');
    const hashCachePath = path.join(cacheDir, 'hashes.json');

    const s = spinner();
    // @ts-ignore
    s.start(`Skanowanie katalogu: ${pc.cyan(target)} ...`);

    await new Promise(resolve => setTimeout(resolve, 800));

    let vueFiles: string[];
    try {
        vueFiles = findVueFiles(targetPath);
    } catch {
        s.stop(pc.red('Nie znaleziono katalogu! Upewnij się, że jesteś w projekcie Nuxt/Vue.'));
        process.exit(1);
    }

    if (vueFiles.length === 0) {
        s.stop(pc.yellow('Nie znaleziono żadnych plików .vue do analizy.'));
        process.exit(0);
    }

    // Załaduj cache
    let prevHashCache: FileHashCache = {};
    if (fs.existsSync(hashCachePath)) {
        try { prevHashCache = JSON.parse(fs.readFileSync(hashCachePath, 'utf-8')); } catch { /* ignore */ }
    }
    const cacheStore = loadReportStore(cacheDir);

    // Zbierz wszystkie pliki i sprawdź które wymagają ponownej analizy
    const tsFiles = findTypeScriptFiles(targetPath);
    const composableFiles = findComposableFiles(targetPath);
    const storeFiles = findStoreFiles(targetPath);
    const allFilesForAnalysis = [...vueFiles, ...tsFiles];
    const { changed: changedFiles, unchanged: unchangedFiles } =
        await getChangedFiles(allFilesForAnalysis, prevHashCache);
    const changedSet = new Set(changedFiles);

    // Wczytaj wyniki dla niezminionych plików z cache
    const cachedResults: FileAnalysisResult[] = unchangedFiles
        .map(f => cacheStore?.results[f])
        .filter((r): r is FileAnalysisResult => r !== undefined);

    // Analizuj zmienione pliki .vue
    const results: AnalysisResult[] = [];
    const islandResults: FileAnalysisResult[] = [];
    for (const file of vueFiles.filter(f => changedSet.has(f))) {
        const content = fs.readFileSync(file, 'utf-8');
        const res = analyzeVueFile(file, content);
        if (res && res.status !== 'ok') results.push(res);
        const islandRes = analyzeIsland(file, content);
        if (islandRes.anomalies.length > 0) islandResults.push(islandRes);
    }

    // Analizuj zmienione composables
    const composableResults: FileAnalysisResult[] = [];
    for (const file of composableFiles.filter(f => changedSet.has(f))) {
        const content = fs.readFileSync(file, 'utf-8');
        const res = analyzeComposableFile(file, content);
        if (res.anomalies.length > 0) composableResults.push(res);
    }

    // Pinia — cross-file, zawsze pełna analiza
    const allProjectFiles = [...vueFiles, ...composableFiles, ...storeFiles];
    const piniaResults: FileAnalysisResult[] = analyzePiniaProject(storeFiles, allProjectFiles);

    // Tree-shaking — tylko zmienione
    const treeShakingResults: FileAnalysisResult[] = analyzeTreeShaking(
        allFilesForAnalysis.filter(f => changedSet.has(f))
    );

    // Build speed — cross-file, zawsze pełna analiza
    const buildSpeedResults: FileAnalysisResult[] = analyzeBuildSpeed(allFilesForAnalysis);

    s.stop(
        `Przeanalizowano ${pc.bold(String(vueFiles.length))} .vue, ` +
        `${pc.bold(String(tsFiles.length))} .ts` +
        (unchangedFiles.length > 0 ? pc.dim(` (${unchangedFiles.length} z cache)`) : '')
    );

    // Zbierz wszystkie wyniki (nowe + z cache)
    const freshResults: FileAnalysisResult[] = [
        ...(results as FileAnalysisResult[]),
        ...islandResults,
        ...composableResults,
        ...piniaResults,
        ...treeShakingResults,
        ...buildSpeedResults,
    ];
    const allResults: FileAnalysisResult[] = [...freshResults, ...cachedResults];

    // Wyświetl note() per plik (tylko dla nowych wyników)
    freshResults.forEach(result => {
        const relativePath = path.relative(process.cwd(), result.filePath);
        let message = '';
        result.anomalies.forEach(anomaly => {
            const icon = anomaly.severity === 'high' ? pc.red('▲') : anomaly.severity === 'medium' ? pc.yellow('■') : pc.dim('○');
            message += `${icon} [${anomaly.code}] ${anomaly.message}\n`;
        });
        if (message) note(message.trim(), pc.yellow(`Plik: ${relativePath}`));
    });

    // Zbuduj ReportData
    const projectName = path.basename(targetPath);
    const reportData = buildReportData(allResults, allFilesForAnalysis.length, unchangedFiles.length, projectName);

    // Diff z poprzednim skanem
    const currentLastReport = buildLastReport(reportData.issues, getCategoryForCode);
    const diff = cacheStore ? diffReports(currentLastReport, cacheStore.lastReport) : null;

    // Uruchom reporter (terminal summary + opcjonalny HTML/JSON)
    await runReporter(reportData, diff, targetPath);

    // Zapisz cache
    const newHashes = await buildHashSnapshot(allFilesForAnalysis);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(hashCachePath, JSON.stringify(newHashes, null, 2));
    const newStoredResults: StoredResults = {};
    allResults.forEach(r => { newStoredResults[r.filePath] = r; });
    saveReportStore(cacheDir, newStoredResults, currentLastReport);
}

main().catch(console.error);
