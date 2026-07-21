import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

test('scaffolded package ships a V2 manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'or3.manifest.json'), 'utf8'));
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.kind).toBe('plugin');
    expect(typeof manifest.id).toBe('string');
    expect(manifest.trust).toBe('trusted-host');
});
