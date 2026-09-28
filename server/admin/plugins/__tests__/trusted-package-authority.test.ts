import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageGrantCandidate } from '../package-operation-support';

function trustedPackage(grants: string[]): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-trusted-authority-'));
    writeFileSync(resolve(root, 'or3.manifest.json'), JSON.stringify({
        manifestVersion: 2,
        kind: 'plugin',
        id: 'or3.test-authority',
        name: 'Authority fixture',
        version: '1.0.0',
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'host' } },
        requestedGrants: grants,
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'trusted-host',
        settings: { version: 1 },
        stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
    }));
    return root;
}

describe('trusted package grant authority', () => {
    it('binds raw ZIP consent to manifest grants without portable descriptors', async () => {
        const first = await packageGrantCandidate({
            packagePath: trustedPackage(['ui.sidebar.register']),
            packageDigest: null,
        });
        const expanded = await packageGrantCandidate({
            packagePath: trustedPackage(['ui.sidebar.register', 'network.http']),
            packageDigest: null,
        });
        expect(first.authoritySha256).toMatch(/^sha256-[0-9a-f]{64}$/);
        expect(first.authority?.grants).toEqual(['ui.sidebar.register']);
        expect(expanded.authoritySha256).not.toBe(first.authoritySha256);
    });
});
