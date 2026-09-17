import {
    copyFileSync,
    existsSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const packageJsonPath = resolve(packageRoot, 'package.json');
const backupPath = resolve(packageRoot, '.publish-backup.json');

const SUBPATHS = {
    '.': 'index',
    './manifest': 'manifest',
    './host': 'host',
    './testing': 'testing',
    './package-tree': 'package-tree',
    './profile': 'profile',
    './state-compatibility': 'state-compatibility',
    './package-archive': 'cli/archive',
    './ui': 'ui',
    './portable': 'portable',
};

function distExports() {
    const exports = {};
    for (const [subpath, entry] of Object.entries(SUBPATHS)) {
        exports[subpath] = {
            types: `./dist/${entry}.d.ts`,
            import: `./dist/${entry}.js`,
        };
    }
    return exports;
}

if (process.argv.includes('--restore')) {
    if (existsSync(backupPath)) {
        copyFileSync(backupPath, packageJsonPath);
        rmSync(backupPath, { force: true });
        process.stderr.write('[or3/plugin-sdk] repository package.json restored\n');
    }
} else {
    if (!existsSync(backupPath)) copyFileSync(packageJsonPath, backupPath);
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    manifest.exports = distExports();
    delete manifest.private;
    writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stderr.write(
        '[or3/plugin-sdk] publish manifest applied (exports -> ./dist/*)\n'
    );
}
