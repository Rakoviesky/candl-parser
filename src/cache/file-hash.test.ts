import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { computeFileHash, getChangedFiles, buildHashSnapshot } from './file-hash';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candl-hash-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

describe('computeFileHash', () => {
    test('returns hex string of length 64', async () => {
        const f = path.join(tmpDir, 'test.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const hash = await computeFileHash(f);
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    test('same content = same hash', async () => {
        const f1 = path.join(tmpDir, 'a.ts');
        const f2 = path.join(tmpDir, 'b.ts');
        fs.writeFileSync(f1, 'const x = 1;');
        fs.writeFileSync(f2, 'const x = 1;');
        expect(await computeFileHash(f1)).toBe(await computeFileHash(f2));
    });

    test('different content = different hash', async () => {
        const f1 = path.join(tmpDir, 'a.ts');
        const f2 = path.join(tmpDir, 'b.ts');
        fs.writeFileSync(f1, 'const x = 1;');
        fs.writeFileSync(f2, 'const x = 2;');
        expect(await computeFileHash(f1)).not.toBe(await computeFileHash(f2));
    });
});

describe('getChangedFiles', () => {
    test('marks all files as changed when cache is empty', async () => {
        const f = path.join(tmpDir, 'a.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const result = await getChangedFiles([f], {});
        expect(result.changed).toContain(f);
        expect(result.unchanged).toHaveLength(0);
    });

    test('marks unchanged files correctly', async () => {
        const f = path.join(tmpDir, 'a.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const hash = await computeFileHash(f);
        const result = await getChangedFiles([f], { [f]: hash });
        expect(result.unchanged).toContain(f);
        expect(result.changed).toHaveLength(0);
    });

    test('marks modified files as changed', async () => {
        const f = path.join(tmpDir, 'a.ts');
        fs.writeFileSync(f, 'const x = 1;');
        const result = await getChangedFiles([f], { [f]: 'old-hash-abc' });
        expect(result.changed).toContain(f);
    });
});

describe('buildHashSnapshot', () => {
    test('returns empty object for empty file list', async () => {
        const snapshot = await buildHashSnapshot([]);
        expect(snapshot).toEqual({});
    });

    test('returns hash for each file', async () => {
        const f1 = path.join(tmpDir, 'a.ts');
        const f2 = path.join(tmpDir, 'b.ts');
        fs.writeFileSync(f1, 'const x = 1;');
        fs.writeFileSync(f2, 'const y = 2;');
        const snapshot = await buildHashSnapshot([f1, f2]);
        expect(Object.keys(snapshot)).toHaveLength(2);
        expect(snapshot[f1]).toHaveLength(64);
        expect(snapshot[f2]).toHaveLength(64);
        expect(snapshot[f1]).not.toBe(snapshot[f2]);
    });
});
