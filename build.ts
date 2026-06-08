import { $ } from 'bun';
import fs from 'fs';
import path from 'path';

const STUB_PACKAGES = [
    'atpl', 'babel-core', 'bracket-template', 'coffee-script', 'dot',
    'dustjs-linkedin', 'eco', 'ect', 'ejs', 'haml-coffee', 'hamlet', 'hamljs',
    'handlebars', 'hogan.js', 'htmling', 'jazz', 'jqtpl', 'just', 'liquor',
    'lodash', 'marko', 'mote', 'mustache', 'plates', 'ractive', 'react',
    'react-dom', 'slm', 'squirrelly', 'teacup', 'templayed', 'toffee', 'twig',
    'twing', 'underscore', 'vash', 'velocityjs', 'walrus', 'whiskers',
];

const STUB_SUBPATHS: Record<string, string[]> = {
    'react-dom': ['server'],
    'teacup': ['lib/express'],
};

const NODE_MODULES = path.join(import.meta.dir, 'node_modules');
const STUB_CONTENT = 'module.exports = {};';
const CREATED_STUBS: string[] = [];

function createStub(pkgName: string, subpath?: string): void {
    const pkgDir = path.join(NODE_MODULES, pkgName);
    const alreadyExists = fs.existsSync(pkgDir) && !subpath;
    if (alreadyExists) return;

    if (!subpath) {
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), STUB_CONTENT);
        CREATED_STUBS.push(pkgDir);
    } else {
        const subDir = path.join(pkgDir, path.dirname(subpath));
        fs.mkdirSync(subDir, { recursive: true });
        const stubFile = path.join(pkgDir, `${subpath}.js`);
        if (!fs.existsSync(stubFile)) {
            fs.writeFileSync(stubFile, STUB_CONTENT);
            CREATED_STUBS.push(stubFile);
        }
    }
}

function cleanup(): void {
    for (const stubPath of CREATED_STUBS) {
        try {
            if (fs.statSync(stubPath).isDirectory()) {
                fs.rmSync(stubPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(stubPath);
            }
        } catch {}
    }
}

// 1. Utwórz stuby
console.log('Creating stubs for optional template engines...');
for (const pkg of STUB_PACKAGES) {
    createStub(pkg);
    for (const sub of STUB_SUBPATHS[pkg] ?? []) {
        createStub(pkg, sub);
    }
}

// 2. Zbuduj binarię
console.log('Building binary...');
try {
    const result = await $`bun build --compile src/index.ts --outfile candl-parser`.quiet();
    console.log(result.stdout.toString());
    console.log('✓ Binary built: candl-parser');
} catch (err: any) {
    console.error('Build failed:\n' + err.stderr?.toString());
    cleanup();
    process.exit(1);
} finally {
    // 3. Posprzątaj stuby
    cleanup();
    console.log('Stubs cleaned up.');
}
