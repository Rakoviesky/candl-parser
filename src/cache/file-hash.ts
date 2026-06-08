export type FileHashCache = Record<string, string>;

export async function computeFileHash(filePath: string): Promise<string> {
    const buffer = await Bun.file(filePath).arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function getChangedFiles(
    files: string[],
    cache: FileHashCache,
): Promise<{ changed: string[]; unchanged: string[] }> {
    const changed: string[] = [];
    const unchanged: string[] = [];

    await Promise.all(files.map(async (f) => {
        const hash = await computeFileHash(f);
        if (cache[f] === hash) {
            unchanged.push(f);
        } else {
            changed.push(f);
        }
    }));

    return { changed, unchanged };
}

export async function buildHashSnapshot(files: string[]): Promise<FileHashCache> {
    const entries = await Promise.all(
        files.map(async (f) => [f, await computeFileHash(f)] as const)
    );
    return Object.fromEntries(entries);
}
