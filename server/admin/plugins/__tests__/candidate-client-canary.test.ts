import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CLIENT_CANARY_PENDING_CODE,
    PluginClientCanaryStore,
} from '../candidate-client-canary';
import { clientCanaryStepFromEvidence } from '../package-operation-support';
import type { CandidateClientCanaryContext } from '../package-candidate-canary';
import { readPackageClientEntry } from '../package-client-entry';
import type { Or3ExtensionManifestV2 } from '../../extensions/types';
import { PluginPackageAssetReader } from '../package-assets';
import { PluginPackagePointerStore } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';

const DIGEST = `sha256-${'a'.repeat(64)}` as const;
const GRANTS = {
    requestedGrants: ['settings.read'],
    approvedGrants: ['settings.read'],
    revision: 'g1',
    status: 'current' as const,
};

function ticketRequest() {
    return {
        pluginId: 'or3.sample-utility',
        packageDigest: DIGEST,
        workspaceId: 'ws-1',
        clientId: 'admin-browser-canary',
        profile: 'or3-portable-client-v1',
        clientEntry: { entry: 'client.mjs', isolation: 'worker' as const, digest: DIGEST },
        grants: GRANTS,
    };
}

describe('client canary tickets', () => {
    it('issues a single-use ticket and refuses a replay', async () => {
        const store = new PluginClientCanaryStore(mkdtempSync(resolve(tmpdir(), 'or3-canary-')));
        const ticket = await store.issueTicket(ticketRequest(), 1_000);
        expect(ticket.expiresAt).toBeGreaterThan(1_000);

        const report = {
            ticketId: ticket.ticketId,
            nonce: ticket.nonce,
            browser: 'chromium',
            abiVersion: 1,
            status: 'passed' as const,
        };
        expect((await store.readTicket(ticket.ticketId))?.nonce).toBe(ticket.nonce);
        expect((await store.redeemTicket(report, 1_001))?.ticketId).toBe(ticket.ticketId);
        // One-time: the file is gone, so a replayed report cannot pass twice.
        expect(await store.redeemTicket(report, 1_002)).toBeNull();
    });

    it('records tickets with owner-only permissions', async () => {
        const store = new PluginClientCanaryStore(mkdtempSync(resolve(tmpdir(), 'or3-canary-')));
        const ticket = await store.issueTicket(ticketRequest(), 1_000);
        expect(statSync(store.ticketPath(ticket.ticketId)).mode & 0o777).toBe(0o600);
    });

    it('refuses a wrong nonce or an expired ticket', async () => {
        const store = new PluginClientCanaryStore(mkdtempSync(resolve(tmpdir(), 'or3-canary-')));
        const first = await store.issueTicket(ticketRequest(), 1_000);
        expect(
            await store.redeemTicket(
                {
                    ticketId: first.ticketId,
                    nonce: 'not-the-nonce',
                    browser: 'chromium',
                    abiVersion: 1,
                    status: 'passed',
                },
                1_001
            )
        ).toBeNull();

        const second = await store.issueTicket(ticketRequest(), 2_000);
        expect(
            await store.redeemTicket(
                {
                    ticketId: second.ticketId,
                    nonce: second.nonce,
                    browser: 'chromium',
                    abiVersion: 1,
                    status: 'passed',
                },
                second.expiresAt + 1
            )
        ).toBeNull();
    });
});

describe('client canary evidence', () => {
    it('round-trips evidence and ignores evidence for another digest', async () => {
        const store = new PluginClientCanaryStore(mkdtempSync(resolve(tmpdir(), 'or3-canary-')));
        await store.recordEvidence({
            schemaVersion: 1,
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            workspaceId: 'ws-1',
            clientId: 'admin-browser-canary',
            profile: 'or3-portable-client-v1',
            browser: 'chromium',
            abiVersion: 1,
            status: 'passed',
            recordedAt: 5,
        });
        expect(
            (await store.readEvidence('or3.sample-utility', DIGEST, 'ws-1'))?.status
        ).toBe('passed');
        expect(await store.readEvidence('or3.sample-utility', DIGEST, 'ws-2')).toBeNull();
    });

    it('never turns a missing report into a pass', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-canary-'));
        const store = new PluginClientCanaryStore(root);
        const step = clientCanaryStepFromEvidence(store, {
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            workspaceId: 'ws-1',
        });

        const clientPackage = writePackage(root, 'or3.sample-utility', {
            trust: 'isolated-client',
            client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' },
        });
        expect(await step(clientContext(clientPackage, DIGEST))).toEqual({
            status: 'blocked',
            code: CLIENT_CANARY_PENDING_CODE,
        });

        await store.recordEvidence({
            schemaVersion: 1,
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            workspaceId: 'ws-1',
            clientId: 'admin-browser-canary',
            profile: 'or3-portable-client-v1',
            browser: 'chromium',
            abiVersion: 1,
            status: 'passed',
            recordedAt: 6,
        });
        expect(await step(clientContext(clientPackage, DIGEST))).toEqual({ status: 'passed' });
    });

    it('reports a blocked browser run with its code and skips server-only packages', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-canary-'));
        const store = new PluginClientCanaryStore(root);
        await store.recordEvidence({
            schemaVersion: 1,
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            workspaceId: 'ws-1',
            clientId: 'admin-browser-canary',
            profile: 'or3-portable-client-v1',
            browser: 'webkit',
            abiVersion: 1,
            status: 'blocked',
            code: 'browser-unsupported',
            recordedAt: 7,
        });
        const step = clientCanaryStepFromEvidence(store, {
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            workspaceId: 'ws-1',
        });
        expect(
            await step(
                clientContext(
                    writePackage(root, 'or3.sample-utility', {
                        trust: 'isolated-client',
                        client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' },
                    }),
                    DIGEST
                )
            )
        ).toEqual({ status: 'blocked', code: 'browser-unsupported' });

        expect(
            await step(
                clientContext(
                    writePackage(root, 'or3.server-plugin', {
                        trust: 'trusted-host',
                        client: undefined,
                    }),
                    DIGEST
                )
            )
        ).toEqual({ status: 'skipped', code: 'server-only-profile' });
    });
});

describe('client entry reading', () => {
    it('hashes the stored entry and refuses a bare import', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-canary-'));
        const pluginId = 'or3.sample-utility';
        const packageRoot = resolve(root, '.store', pluginId, DIGEST);
        mkdirSync(packageRoot, { recursive: true });
        const manifest = v2Manifest(pluginId, {
            client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' },
        });
        writeFileSync(resolve(packageRoot, 'or3.manifest.json'), JSON.stringify(manifest));
        const packages = new ImmutablePluginPackageStore(root);
        const reader = new PluginPackageAssetReader(
            packages,
            new PluginPackagePointerStore(root, packages)
        );

        writeFileSync(resolve(packageRoot, 'client.mjs'), 'export const ready = true;\n');
        const entry = await readPackageClientEntry({
            pluginId,
            packageDigest: DIGEST,
            manifest,
            reader,
            requireSelected: false,
        });
        expect(entry?.isolation).toBe('worker');
        expect(entry?.digest).toMatch(/^sha256-[a-f0-9]{64}$/);

        writeFileSync(
            resolve(packageRoot, 'client.mjs'),
            "import { defineOr3Plugin } from '@or3/plugin-sdk';\nexport default defineOr3Plugin({});\n"
        );
        await expect(
            readPackageClientEntry({
                pluginId,
                packageDigest: DIGEST,
                manifest,
                reader,
                requireSelected: false,
            })
        ).rejects.toMatchObject({ code: 'client-entry-unresolvable' });
    });
});

function clientContext(packagePath: string, packageDigest: `sha256-${string}`): CandidateClientCanaryContext {
    return {
        pluginId: 'or3.sample-utility',
        workspaceId: 'ws-1',
        packageDigest,
        packagePath,
        clientId: 'admin-browser-canary',
        visibility: 'hidden' as const,
        canPublish: false,
    };
}

/** A minimal schema-valid Manifest V2 for the canary fixtures. */
function v2Manifest(
    pluginId: string,
    input: {
        readonly client?: { entry: string; format: 'esm'; isolation: 'worker' };
        readonly trust?: 'isolated-client' | 'trusted-host';
    } = {}
): Or3ExtensionManifestV2 {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: pluginId,
        name: 'Sample',
        version: '1.0.0',
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: input.client
            ? { client: input.client }
            : { server: { routes: [{ method: 'GET', path: 'ping', handler: 'server/ping.mjs' }] } },
        requestedGrants: [],
        capabilities: [],
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: input.trust ?? 'isolated-client',
        settings: { version: 1 },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe',
        },
    };
}

function writePackage(
    root: string,
    pluginId: string,
    input: {
        readonly trust: 'isolated-client' | 'trusted-host';
        readonly client: { entry: string; format: 'esm'; isolation: 'worker' } | undefined;
    }
): string {
    // The immutable store keeps verified packages under `<root>/.store/...`.
    const packageRoot = resolve(root, '.store', pluginId, DIGEST);
    mkdirSync(packageRoot, { recursive: true });
    const manifest = v2Manifest(pluginId, {
        ...(input.client ? { client: input.client } : {}),
        trust: input.trust,
    });
    writeFileSync(resolve(packageRoot, 'or3.manifest.json'), JSON.stringify(manifest));
    return packageRoot;
}
