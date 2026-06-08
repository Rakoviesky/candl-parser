import fs from 'fs';
import path from 'path';

export function findVueFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        // Pomijamy node_modules i foldery ukryte (np. .nuxt, .git)
        if (fs.statSync(filePath).isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
            findVueFiles(filePath, fileList);
        } else if (file.endsWith('.vue')) {
            fileList.push(filePath);
        }
    }

    return fileList;
}

export function findComposableFiles(dir: string): string[] {
    const composablesDir = path.join(dir, 'composables');
    if (!fs.existsSync(composablesDir)) return [];

    return fs.readdirSync(composablesDir)
        .filter(f => f.endsWith('.ts'))
        .map(f => path.join(composablesDir, f));
}

export function findStoreFiles(dir: string): string[] {
    const storesDir = path.join(dir, 'stores');
    if (!fs.existsSync(storesDir)) return [];

    return fs.readdirSync(storesDir)
        .filter(f => f.endsWith('.ts'))
        .map(f => path.join(storesDir, f));
}

const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist', '.git', 'coverage', '.cache']);

export function findTypeScriptFiles(dir: string, fileList: string[] = []): string[] {
    let files: string[];
    try {
        files = fs.readdirSync(dir);
    } catch {
        return fileList;
    }

    for (const file of files) {
        const filePath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            continue;
        }

        if (stat.isDirectory()) {
            if (!SKIP_DIRS.has(file) && !file.startsWith('.')) {
                findTypeScriptFiles(filePath, fileList);
            }
        } else if (
            file.endsWith('.ts') &&
            !file.endsWith('.d.ts') &&
            !file.endsWith('.test.ts') &&
            !file.endsWith('.spec.ts')
        ) {
            fileList.push(filePath);
        }
    }

    return fileList;
}