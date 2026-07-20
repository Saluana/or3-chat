import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const examplesDir = resolve(repoRoot, 'app/plugins/examples');
const fixturePath = resolve(repoRoot, 'tests/plugin-runtime/v1-examples/examples.compile.ts');

describe('V1 example compile fixture coverage', () => {
    it('imports every top-level example plugin without copying or rewriting it', () => {
        const examplePlugins = readdirSync(examplesDir)
            .filter((name) => name.endsWith('.client.ts'))
            .sort();
        const fixture = readFileSync(fixturePath, 'utf8');
        const fixturePlugins = [...fixture.matchAll(/examples\/([^'\"]+\.client)'/g)]
            .map((match) => `${match[1]}.ts`)
            .sort();

        expect(fixturePlugins).toEqual(examplePlugins);
    });
});
