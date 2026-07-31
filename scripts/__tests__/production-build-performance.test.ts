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

    test('summarizes precache, resource hints, and precompressed assets', () => {
        const root = fixture();
        const publicRoot = resolve(root, 'public');
        const entryPath = resolve(publicRoot, '_nuxt', 'entry.js');
        const cssPath = resolve(publicRoot, '_nuxt', 'entry.css');
        const entry = 'const entry = "entry";'.repeat(80);
        const css = 'body { color: red; }'.repeat(80);
        writeFileSync(entryPath, entry);
        writeFileSync(cssPath, css);
        writeFileSync(`${entryPath}.gz`, 'gzip');
        writeFileSync(`${entryPath}.br`, 'brotli');
        writeFileSync(`${cssPath}.gz`, 'gzip');
        writeFileSync(`${cssPath}.br`, 'brotli');
        writeFileSync(
            resolve(publicRoot, 'sw.js'),
            'self.precacheAndRoute([{url:"_nuxt/entry.js",revision:null},{url:"_nuxt/entry.css",revision:null}],{});'
        );
        writeFileSync(
            resolve(publicRoot, 'index.html'),
            [
                '<link href="/_nuxt/entry.js" rel="modulepreload">',
                '<link rel="prefetch" href="/_nuxt/entry.css">',
            ].join('')
        );

        const stats = inspectProductionBuild(root);

        expect(stats.precache).toMatchObject({
            present: true,
            files: 2,
            rawBytes: Buffer.byteLength(entry) + Buffer.byteLength(css),
            missing: [],
        });
        expect(stats.rootHtml.modulepreload).toMatchObject({
            files: 1,
            rawBytes: Buffer.byteLength(entry),
            missing: [],
        });
        expect(stats.rootHtml.prefetch).toMatchObject({
            files: 1,
            rawBytes: Buffer.byteLength(css),
            missing: [],
        });
        expect(stats.compression).toMatchObject({
            eligibleFiles: 2,
            gzipFiles: 2,
            brotliFiles: 2,
            missingGzip: [],
            missingBrotli: [],
        });
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
