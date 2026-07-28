import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stripBrokenOpenRouterSourcemapsPlugin } from '../../../plugins/vite-strip-broken-openrouter-sourcemaps';

const tempDirs: string[] = [];

afterEach(() => {
    // Temp dirs are under OS tmp; leave cleanup to the OS.
    tempDirs.length = 0;
});

function makeOpenRouterFixture(opts: {
    mapComment: string;
    withMapFile?: boolean;
}): string {
    const root = mkdtempSync(join(tmpdir(), 'or3-openrouter-sm-'));
    tempDirs.push(root);
    const libDir = join(
        root,
        'node_modules',
        '@openrouter',
        'sdk',
        'esm',
        'lib',
    );
    mkdirSync(libDir, { recursive: true });
    const file = join(libDir, 'stream-type-guards.js');
    writeFileSync(
        file,
        `export const ok = true;\n${opts.mapComment}\n`,
        'utf8',
    );
    if (opts.withMapFile) {
        writeFileSync(join(libDir, 'stream-type-guards.js.map'), '{}', 'utf8');
    }
    return file;
}

describe('stripBrokenOpenRouterSourcemapsPlugin', () => {
    it('strips sourceMappingURL when the map file is missing', () => {
        const file = makeOpenRouterFixture({
            mapComment: '//# sourceMappingURL=stream-type-guards.js.map',
        });
        const plugin = stripBrokenOpenRouterSourcemapsPlugin();
        const load = plugin.load;
        expect(typeof load).toBe('function');
        const result =
            typeof load === 'function'
                ? (load as (id: string) => string | null).call(
                      { meta: {} },
                      file,
                  )
                : null;

        expect(result).toBeTypeOf('string');
        expect(result).not.toContain('sourceMappingURL');
        expect(result).toContain('export const ok = true;');
    });

    it('leaves modules alone when the map file exists', () => {
        const file = makeOpenRouterFixture({
            mapComment: '//# sourceMappingURL=stream-type-guards.js.map',
            withMapFile: true,
        });
        const plugin = stripBrokenOpenRouterSourcemapsPlugin();
        const load = plugin.load;
        const result =
            typeof load === 'function'
                ? (load as (id: string) => string | null).call(
                      { meta: {} },
                      file,
                  )
                : null;

        expect(result).toBeNull();
    });

    it('ignores non-openrouter modules', () => {
        const plugin = stripBrokenOpenRouterSourcemapsPlugin();
        const load = plugin.load;
        const result =
            typeof load === 'function'
                ? (load as (id: string) => string | null).call(
                      { meta: {} },
                      '/tmp/other-pkg/index.js',
                  )
                : null;
        expect(result).toBeNull();
    });
});
