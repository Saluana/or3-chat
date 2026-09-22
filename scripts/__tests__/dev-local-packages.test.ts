import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    localPackagesEnabled,
    resolveLocalPackageAliases,
} from '../../shared/dev/local-packages';

const workspaces: string[] = [];

/** Build a workspace root containing `or3-chat` plus the given siblings. */
function workspace(
    siblings: Record<string, { name?: string; entries?: readonly string[]; dependencies?: Record<string, string> } | null>,
): string {
    const root = mkdtempSync(join(tmpdir(), 'or3-local-packages-'));
    workspaces.push(root);
    const app = join(root, 'or3-chat');
    mkdirSync(app, { recursive: true });
    for (const [sibling, spec] of Object.entries(siblings)) {
        if (spec === null) continue;
        const dir = join(root, sibling);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: spec.name, version: '0.0.0', dependencies: spec.dependencies }),
        );
        for (const entry of spec.entries ?? []) {
            const entryPath = join(dir, entry);
            mkdirSync(dirname(entryPath), { recursive: true });
            writeFileSync(entryPath, 'export {};\n');
        }
    }
    return app;
}

afterEach(() => {
    for (const root of workspaces.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('local package sources', () => {
    it('defaults to sibling sources in development only', () => {
        expect(localPackagesEnabled({ NODE_ENV: 'development' })).toBe(true);
        expect(localPackagesEnabled({ NODE_ENV: 'production' })).toBe(false);
        expect(localPackagesEnabled({})).toBe(false);
        expect(
            localPackagesEnabled({ NODE_ENV: 'production', OR3_USE_LOCAL_PACKAGES: 'true' }),
        ).toBe(false);
        expect(
            localPackagesEnabled({ NODE_ENV: 'development', OR3_USE_LOCAL_PACKAGES: 'false' }),
        ).toBe(false);
    });

    it('aliases every sibling checkout that matches its package and entry', () => {
        const app = workspace({
            'or3-vsc': { name: 'or3-scroll', entries: ['src/lib/index.ts'] },
            'or3-workflows/packages/workflow-core': {
                name: 'or3-workflow-core',
                entries: ['src/index.ts'],
            },
            'or3-workflows/packages/workflow-vue': {
                name: 'or3-workflow-vue',
                entries: ['src/index.ts', 'src/styles/variables.css'],
            },
        });
        const resolution = resolveLocalPackageAliases(app, { NODE_ENV: 'development' });

        expect(resolution.enabled).toBe(true);
        expect(resolution.aliases.map((alias) => String(alias.find))).toEqual([
            '/^or3-scroll$/',
            '/^or3-workflow-vue\\/style\\.css$/',
            '/^or3-workflow-vue$/',
            '/^or3-workflow-core$/',
        ]);
        expect(resolution.skipped).toEqual([]);
    });

    it('keeps the remaining aliases when one checkout is unusable', () => {
        const app = workspace({
            'or3-vsc': { name: 'or3-scroll', entries: ['src/lib/index.ts'] },
            // A renamed checkout must never be aliased as `or3-workflow-core`.
            'or3-workflows/packages/workflow-core': {
                name: 'something-else',
                entries: ['src/index.ts'],
            },
            'or3-workflows/packages/workflow-vue': {
                name: 'or3-workflow-vue',
                entries: ['src/index.ts', 'src/styles/variables.css'],
            },
        });
        const resolution = resolveLocalPackageAliases(app, { NODE_ENV: 'development' });

        expect(resolution.aliases.map((alias) => String(alias.find))).toContain(
            '/^or3-scroll$/',
        );
        expect(resolution.aliases.map((alias) => String(alias.find))).not.toContain(
            '/^or3-workflow-core$/',
        );
        expect(resolution.skipped.join('\n')).toContain('declares "something-else"');
    });

    it('skips a checkout whose aliased source file is missing', () => {
        const app = workspace({
            'or3-vsc': { name: 'or3-scroll', entries: ['src/lib/other.ts'] },
        });
        const resolution = resolveLocalPackageAliases(app, { NODE_ENV: 'development' });

        expect(resolution.aliases).toEqual([]);
        expect(resolution.skipped.join('\n')).toContain('src/lib/index.ts is missing');
    });

    it('resolves nothing when local sources are disabled', () => {
        const app = workspace({
            'or3-vsc': { name: 'or3-scroll', entries: ['src/lib/index.ts'] },
        });
        const resolution = resolveLocalPackageAliases(app, {
            NODE_ENV: 'development',
            OR3_USE_LOCAL_PACKAGES: 'false',
        });

        expect(resolution).toEqual({ enabled: false, aliases: [], selected: [], skipped: [] });
    });
});

it('rejects the entire workflow group when core does not meet the UI range', () => {
    const app = workspace({
        'or3-workflows/packages/workflow-core': { name: 'or3-workflow-core', entries: ['src/index.ts'] },
        'or3-workflows/packages/workflow-vue': { name: 'or3-workflow-vue', entries: ['src/index.ts', 'src/styles/variables.css'], dependencies: { 'or3-workflow-core': '^9.0.0' } },
    });
    const result = resolveLocalPackageAliases(app, { NODE_ENV: 'development' });
    expect(result.aliases).toEqual([]);
    expect(result.skipped.join(' ')).toContain('requires or3-workflow-core@^9.0.0');
});
it('rejects missing transitive source before selecting any workflow aliases', () => {
    const app = workspace({
        'or3-workflows/packages/workflow-core': { name: 'or3-workflow-core', entries: ['src/index.ts'] },
        'or3-workflows/packages/workflow-vue': { name: 'or3-workflow-vue', entries: ['src/index.ts', 'src/styles/variables.css'] },
    });
    writeFileSync(join(app, '../or3-workflows/packages/workflow-core/src/index.ts'), "export * from './missing';");
    const result = resolveLocalPackageAliases(app, { NODE_ENV: 'development' });
    expect(result.aliases).toEqual([]);
    expect(result.skipped.join(' ')).toContain('source import is missing');
});
