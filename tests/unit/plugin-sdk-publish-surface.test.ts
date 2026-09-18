import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    BUILD_ENTRIES,
    SUBPATH_ENTRIES,
} from '../../packages/plugin-sdk/scripts/publish-entries.mjs';

/**
 * The published package rewrites `exports` to `./dist/<entry>.js` and `files`
 * ships `dist`, so a subpath whose module is not in the JavaScript build would
 * resolve to a file that does not exist. (The declarations are emitted for every
 * source file, which is what made this easy to miss.)
 */
const packageRoot = resolve(import.meta.dirname, '../../packages/plugin-sdk');

describe('plugin SDK published surface', () => {
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
