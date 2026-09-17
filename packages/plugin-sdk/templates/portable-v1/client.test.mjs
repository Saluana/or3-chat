import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin, { exampleManifest } from './client.mjs';

const root = dirname(fileURLToPath(import.meta.url));

test('portable starter ships an isolated-client V2 manifest', () => {
    const manifest = JSON.parse(
        readFileSync(resolve(root, 'or3.manifest.json'), 'utf8')
    );
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.kind).toBe('plugin');
    expect(manifest.trust).toBe('isolated-client');
    expect(manifest.runtime.client.isolation).toBe('worker');
    expect(manifest.features.required).toContain('or3-portable-client-v1');
    expect(manifest.runtime.server).toBeUndefined();
});

test('client entry exports the manifest declared by or3.manifest.json', () => {
    expect(plugin.manifest.id).toBe(exampleManifest.id);
    expect(typeof plugin.setup).toBe('function');
});

test('portable descriptors agree with the manifest', () => {
    const setup = JSON.parse(readFileSync(resolve(root, 'or3.setup.json'), 'utf8'));
    expect(setup.settingsSchemaPath).toBe('settings.schema.json');
    expect(setup.connections).toEqual([]);
    expect(typeof setup.firstAction.operationId).toBe('string');
    const policy = readFileSync(resolve(root, 'or3.package-policy.json'), 'utf8');
    expect(policy).toContain('or3-portable-client-v1');
});
