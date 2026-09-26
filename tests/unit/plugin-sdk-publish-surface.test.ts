import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    BUILD_ENTRIES,
    SUBPATH_ENTRIES,
} from '../../packages/plugin-sdk/scripts/publish-entries.mjs';
import { readPackageZip } from '../../packages/plugin-sdk/src/cli/archive';

/**
 * The published package rewrites `exports` to `./dist/<entry>.js` and `files`
 * ships `dist`, so a subpath whose module is not in the JavaScript build would
 * resolve to a file that does not exist. (The declarations are emitted for every
 * source file, which is what made this easy to miss.)
 */
const packageRoot = resolve(import.meta.dirname, '../../packages/plugin-sdk');

describe('plugin SDK published surface', () => {
    it('runs the documented workflow from a packed SDK in an external directory', async () => {
        const external = mkdtempSync(resolve(tmpdir(), 'or3-sdk-external-'));
        const buildSource = resolve(external, 'sdk-source');
        const originalManifest = readFileSync(resolve(packageRoot, 'package.json'), 'utf8');
        function run(command: string, args: string[], cwd = external): string {
            const result = spawnSync(command, args, {
                cwd, encoding: 'utf8', timeout: 60_000,
                env: { ...process.env, NODE_PATH: '', BUN_INSTALL_CACHE_DIR: resolve(external, '.bun-cache') },
            });
            if (result.error || result.status !== 0) {
                throw new Error(`${command} ${args.join(' ')}: ${result.error ?? result.stderr}\n${result.stdout}`);
            }
            return result.stdout;
        }
        try {
            // Prepack rewrites package.json and deletes dist: build a copy so
            // concurrent tests and developer builds keep their own SDK intact.
            cpSync(packageRoot, buildSource, {
                recursive: true,
                filter: (path) => !['node_modules', 'dist', '.publish-backup.json'].some(
                    (name) => path === resolve(packageRoot, name)
                ),
            });
            symlinkSync(resolve(packageRoot, '../../node_modules'), resolve(buildSource, 'node_modules'), 'dir');
            run('bun', ['pm', 'pack', '--destination', external], buildSource);
            expect(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).toBe(originalManifest);
            writeFileSync(resolve(external, 'package.json'), '{"private":true,"type":"module"}\n');
            const version = JSON.parse(originalManifest).version;
            const tarball = `./or3-plugin-sdk-${version}.tgz`;
            run('bun', ['add', tarball]);
            const cli = resolve(external, 'node_modules/.bin/or3-plugin');
            run(cli, ['create', '--id', 'or3.example', '--dir', './example', '--sdk-source', tarball]);
            const example = resolve(external, 'example');
            run('bun', ['install'], example);
            expect(realpathSync(resolve(example, 'node_modules/@or3/plugin-sdk'))).toContain(realpathSync(external));
            run(cli, ['validate', './example']);
            run(cli, ['test', './example']);
            const built = JSON.parse(run(cli, ['build', './example']));
            const builtEntry = readFileSync(resolve(example, 'dist/client.mjs'), 'utf8');
            expect(builtEntry).not.toContain('@or3/plugin-sdk');
            // Packing must preserve the built bytes even if source changed.
            writeFileSync(resolve(example, 'client.mjs'), "import 'must-not-ship';\n");
            const packed = JSON.parse(run(cli, ['pack', './example', '--archive', './example.or3pkg']));
            expect(packed.digest).toBe(built.digest);
            const extracted = resolve(external, 'extracted');
            await readPackageZip(readFileSync(resolve(external, 'example.or3pkg')), { extractDirectory: extracted });
            expect(readFileSync(resolve(extracted, 'client.mjs'), 'utf8')).toBe(builtEntry);
            run(cli, ['inspect', './example.or3pkg']);
        } finally {
            rmSync(external, { recursive: true, force: true });
        }
    }, 120_000);

    it('builds every module it exports a subpath for', () => {
        for (const [subpath, entry] of Object.entries(SUBPATH_ENTRIES)) {
            expect(
                BUILD_ENTRIES,
                `subpath "${subpath}" needs src/${entry}.ts in the build entries`
            ).toContain(`src/${entry}.ts`);
        }
    });

    it('lists each build entry exactly once', () => {
        expect(new Set(BUILD_ENTRIES).size).toBe(BUILD_ENTRIES.length);
    });

    it('exports the subpaths the repository package declares', () => {
        const manifest = JSON.parse(
            readFileSync(resolve(packageRoot, 'package.json'), 'utf8')
        ) as { exports: Record<string, { import: string }> };
        // The repository manifest points at source; prepack rewrites it for the
        // published tarball. Both must cover the same subpaths.
        expect(Object.keys(manifest.exports).sort()).toEqual(
            Object.keys(SUBPATH_ENTRIES).sort()
        );
        for (const entry of Object.values(manifest.exports)) {
            expect(entry.import.startsWith('./src/')).toBe(true);
        }
    });
});
