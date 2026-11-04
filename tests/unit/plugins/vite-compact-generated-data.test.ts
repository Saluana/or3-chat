import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import originalRanks from 'gpt-tokenizer/bpeRanks/o200k_base';
import originalLanguage from '@shikijs/langs/typescript';
import { afterEach, expect, it } from 'vitest';
import { build } from 'vite';
import { compactGeneratedDataPlugin } from '../../../plugins/vite-compact-generated-data';

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('preserves complete tokenizer ranks and grammar values through a real client build', async () => {
    const root = mkdtempSync(join(tmpdir(), 'or3-generated-data-'));
    directories.push(root);
    const grammarDirectory = join(root, 'node_modules/@shikijs/langs/dist');
    mkdirSync(grammarDirectory, { recursive: true });
    // This boundary must retain own __proto__, numeric edge cases, frozen roots
    // and independent repeated objects, not merely equivalent highlighting text.
    const json = '{"__proto__":{"safe":true},"negativeZero":-0,"large":1e400,"patterns":[{"__proto__":{"safe":true},"match":"repeated long grammar expression"},{"__proto__":{"safe":true},"match":"repeated long grammar expression"}]}';
    const fixture = join(grammarDirectory, 'fixture.mjs');
    writeFileSync(fixture, `export default Object.freeze(JSON.parse(${JSON.stringify(json)}));`);
    const largeJson = json.slice(0, -1) + ',"types":[null,true,false,0,-1,1.5,"",-0,1e400,[],{}],"padding":' +
        JSON.stringify(Array.from({ length: 1000 }, () => ({ name: 'repeated grammar name', match: 'repeated long grammar expression' }))) + '}';
    const largeFixture = join(grammarDirectory, 'large.mjs');
    writeFileSync(largeFixture, `export default Object.freeze(JSON.parse(${JSON.stringify(largeJson)}));`);
    const ranksUrl = import.meta.resolve('gpt-tokenizer/bpeRanks/o200k_base');
    const languageUrl = import.meta.resolve('@shikijs/langs/typescript');
    const entry = join(root, 'entry.mjs');
    writeFileSync(entry, `export {default as fixture} from ${JSON.stringify(fixture)};
export {default as largeFixture} from ${JSON.stringify(largeFixture)};
export {default as ranks} from ${JSON.stringify(fileURLToPath(ranksUrl))};
export {default as language} from ${JSON.stringify(fileURLToPath(languageUrl))};`);
    await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [compactGeneratedDataPlugin()],
        build: {
            outDir: join(root, 'dist'),
            minify: false,
            lib: { entry, formats: ['cjs'], fileName: () => 'entry.cjs' },
        },
    });
    const result = createRequire(import.meta.url)(join(root, 'dist/entry.cjs')) as {
        fixture: { patterns: { match: string }[]; negativeZero: number };
        largeFixture: { patterns: { match: string }[]; negativeZero: number };
        ranks: (string | number[])[];
        language: unknown;
    };
    expect(result.ranks).toStrictEqual(originalRanks);
    expect(result.language).toStrictEqual(originalLanguage);
    for (const [fixture, expected] of [[result.fixture, json], [result.largeFixture, largeJson]] as const) {
        expect(fixture).toStrictEqual(JSON.parse(expected));
        expect(Object.isFrozen(fixture)).toBe(true);
        expect(Object.hasOwn(fixture, '__proto__')).toBe(true);
        expect(Object.is(fixture.negativeZero, -0)).toBe(true);
        fixture.patterns[0]!.match = 'changed';
        expect(fixture.patterns[1]!.match).toBe('repeated long grammar expression');
    }
}, 30_000);
