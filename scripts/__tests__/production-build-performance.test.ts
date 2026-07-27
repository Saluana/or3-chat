import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { inspectProductionBuild } from '../performance/production-build.perf';

const roots: string[] = [];

function fixture(): string {
    const root = resolve(
        process.cwd(),
        'output',
        'test-production-build',
        crypto.randomUUID()
    );
    roots.push(root);
    mkdirSync(resolve(root, 'public', '_nuxt', 'nested'), {
        recursive: true,
    });
    return root;
}

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(
        roots
            .splice(0)
            .map((root) => rm(root, { recursive: true, force: true }))
    );
});

describe('production build performance inspection', () => {
    test('summarizes nested JavaScript and CSS artifacts', () => {
        const root = fixture();
        writeFileSync(
            resolve(root, 'public', '_nuxt', 'entry.js'),
            'const entry = "entry";'
        );
        writeFileSync(
            resolve(root, 'public', '_nuxt', 'nested', 'lazy.js'),
            'const lazy = "lazy chunk";'.repeat(4)
        );
        writeFileSync(
            resolve(root, 'public', '_nuxt', 'entry.css'),
            'body { color: red; }'
        );

        const stats = inspectProductionBuild(root);

        expect(stats.javascript.files).toBe(2);
        expect(stats.javascript.rawBytes).toBeGreaterThan(100);
        expect(stats.javascript.gzipBytes).toBeGreaterThan(0);
        expect(stats.javascript.largest?.path).toBe(
            'public/_nuxt/nested/lazy.js'
        );
        expect(stats.css.files).toBe(1);
        expect(stats.css.rawBytes).toBe(20);
    });

    test('rejects a missing production output', () => {
        const root = resolve(
            process.cwd(),
            'output',
            'test-production-build',
            crypto.randomUUID()
        );
        expect(() => inspectProductionBuild(root)).toThrow(
            'Production client assets are missing'
        );
    });
});
