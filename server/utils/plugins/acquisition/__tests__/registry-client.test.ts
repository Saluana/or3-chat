import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RegistryClient } from '../registry-client';
import { signReleaseMetadataForTest } from '../release-verify';
import {
    encodeReleaseMetadata,
    type ReleaseMetadataDocument,
} from '~~/shared/plugins/acquisition/release-metadata';

const ORIGIN = 'https://market.example';
const REGISTRY = 'https://market.example';
const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function makeKey(keyId = 'or3-release') {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    let binary = '';
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    return {
        keyId,
        privateKeyBase64: btoa(binary),
        publicJwk: { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x as string },
    };
}

function baseDocument(overrides: Partial<ReleaseMetadataDocument> = {}): ReleaseMetadataDocument {
    return {
        schemaVersion: 1,
        releaseId: 'rel_1',
        pluginId: 'acme.sample',
        publisherNamespace: 'acme',
        version: '1.2.3',
        archiveSha256: `sha256-${'a'.repeat(64)}`,
        packageTreeSha256: `sha256-${'b'.repeat(64)}`,
        manifestSha256: `sha256-${'c'.repeat(64)}`,
        authoritySha256: `sha256-${'d'.repeat(64)}`,
        sourceSha256: `sha256-${'e'.repeat(64)}`,
        profile: 'or3-portable-client-v1',
        engines: { or3: '>=1.0.0', pluginApi: '>=1.0.0' },
        features: [],
        requestedGrants: [],
        reviewId: 'rev_1',
        license: 'MIT',
        publishedAt: new Date(Date.now() - 60_000).toISOString(),
        ...overrides,
    };
}

async function makeClient(options: {
    transport: typeof fetch;
    keys: readonly { keyId: string; publicJwk: { kty: string; crv: string; x: string } }[];
    acceptedAdvisorySequence?: number;
    freeDiskBytes?: number;
    maxArtifactBytes?: number;
}) {
    return new RegistryClient({
        registryOrigin: ORIGIN,
        trustRoot: {
            releaseKeys: [...options.keys],
            hostOr3Version: '4.5.1',
            hostPluginApiVersion: '2.0.0',
            acceptedAdvisorySequence: options.acceptedAdvisorySequence ?? 0,
        },
        maxArtifactBytes: options.maxArtifactBytes ?? 8 * 1024,
        reserveBytes: 0,
        acceptedAdvisorySequence: options.acceptedAdvisorySequence ?? 0,
        transport: options.transport,
        freeDiskBytes: async () => options.freeDiskBytes ?? 1024 ** 3,
        now: () => Date.now(),
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('registry resolve (5.2)', () => {
    it('refuses to resolve when no registry is configured', async () => {
        const client = new RegistryClient({
            registryOrigin: '',
            trustRoot: {
                releaseKeys: [],
                hostOr3Version: '4.5.1',
                hostPluginApiVersion: '2.0.0',
                acceptedAdvisorySequence: 0,
            },
            maxArtifactBytes: 1024,
            reserveBytes: 0,
            transport: async () => jsonResponse({}),
        });
        const result = await client.resolveRelease({ expectation: { pluginId: 'acme.sample' } });
        expect(result).toMatchObject({ ok: false, failure: { code: 'registry-unconfigured' } });
    });

    it('resolves a signed release and derives a same-origin artifact URL', async () => {
        const key = await makeKey();
        const signed = await signReleaseMetadataForTest({
            document: baseDocument(),
            keyId: key.keyId,
            privateKeyBase64: key.privateKeyBase64,
        });
        const client = await makeClient({
            keys: [key],
            transport: async (input) => {
                expect(String(input)).toBe(`${REGISTRY}/v1/releases/rel_1/metadata`);
                return jsonResponse(signed);
            },
        });

        const result = await client.resolveRelease({
            expectation: { pluginId: 'acme.sample', releaseId: 'rel_1' },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.artifactUrl).toBe(
            `${REGISTRY}/v1/artifacts/${signed.archiveSha256}/package.or3pkg`
        );
        expect(result.value.metadataSha256).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    it('refuses an untrusted key and a tampered document', async () => {
        const key = await makeKey();
        const signed = await signReleaseMetadataForTest({
            document: baseDocument(),
            keyId: key.keyId,
            privateKeyBase64: key.privateKeyBase64,
        });

        // The host trusts a different key, so this document's key is untrusted.
        const other = await makeKey('or3-other-key');
        const untrusted = await makeClient({
            keys: [other],
            transport: async () => jsonResponse(signed),
        });
        expect(await untrusted.resolveRelease({ expectation: { pluginId: 'acme.sample' } })).toMatchObject({
            ok: false,
            failure: { code: 'release-key-untrusted' },
        });

        // A field changed after signing invalidates the signature.
        const tampered = { ...signed, version: '9.9.9' };
        const client = await makeClient({ keys: [key], transport: async () => jsonResponse(tampered) });
        expect(await client.resolveRelease({ expectation: { pluginId: 'acme.sample' } })).toMatchObject({
            ok: false,
            failure: { code: 'release-key-untrusted' },
        });
    });

    it('refuses stale metadata, wrong profiles and engine mismatches', async () => {
        const key = await makeKey();
        const sign = (document: ReleaseMetadataDocument) =>
            signReleaseMetadataForTest({
                document,
                keyId: key.keyId,
                privateKeyBase64: key.privateKeyBase64,
            });

        const stale = await sign(
            baseDocument({ publishedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString() })
        );
        const profile = await sign(baseDocument({ profile: 'or3-future-profile' }));
        const engines = await sign(baseDocument({ engines: { or3: '>=99.0.0', pluginApi: '>=1.0.0' } }));

        for (const [document, code] of [
            [stale, 'release-expired'],
            [profile, 'release-profile-unsupported'],
            [engines, 'release-engine-unsupported'],
        ] as const) {
            const client = await makeClient({ keys: [key], transport: async () => jsonResponse(document) });
            expect(await client.resolveRelease({ expectation: { pluginId: 'acme.sample' } })).toMatchObject({
                ok: false,
                failure: { code },
            });
        }
    });

    it('refuses identity mismatches and stale advisory sequences', async () => {
        const key = await makeKey();
        const signed = await signReleaseMetadataForTest({
            document: baseDocument(),
            keyId: key.keyId,
            privateKeyBase64: key.privateKeyBase64,
        });
        const client = await makeClient({ keys: [key], transport: async () => jsonResponse(signed) });
        expect(
            await client.resolveRelease({ expectation: { pluginId: 'acme.other' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-identity-mismatch' } });

        const stale = await makeClient({
            keys: [key],
            acceptedAdvisorySequence: 5,
            transport: async () => jsonResponse(signed),
        });
        expect(
            await stale.resolveRelease({
                expectation: { pluginId: 'acme.sample' },
                catalogAdvisorySequence: 4,
                latestAdvisorySequence: 4,
            })
        ).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });
    });

    it('refuses an unreadable or missing release', async () => {
        const key = await makeKey();
        const notFound = await makeClient({
            keys: [key],
            transport: async () => new Response('missing', { status: 404 }),
        });
        expect(
            await notFound.resolveRelease({ expectation: { pluginId: 'acme.sample' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-not-found' } });

        const unreadable = await makeClient({
            keys: [key],
            transport: async () => new Response('not json', { status: 200 }),
        });
        expect(
            await unreadable.resolveRelease({ expectation: { pluginId: 'acme.sample' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-metadata-invalid' } });

        const down = await makeClient({
            keys: [key],
            transport: async () => {
                throw new Error('connection refused');
            },
        });
        expect(await down.resolveRelease({ expectation: { pluginId: 'acme.sample' } })).toMatchObject({
            ok: false,
            failure: { code: 'registry-unreachable', retryable: true },
        });
    });
});

describe('artifact download (5.2)', () => {
    async function resolvedFixture() {
        const key = await makeKey();
        const payload = new TextEncoder().encode('package-bytes');
        const { createHash } = await import('node:crypto');
        const digest = `sha256-${createHash('sha256').update(payload).digest('hex')}`;
        const signed = await signReleaseMetadataForTest({
            document: baseDocument({ archiveSha256: digest as `sha256-${string}` }),
            keyId: key.keyId,
            privateKeyBase64: key.privateKeyBase64,
        });
        const client = await makeClient({ keys: [key], transport: async () => jsonResponse(signed) });
        const resolved = await client.resolveRelease({ expectation: { pluginId: 'acme.sample' } });
        if (!resolved.ok) throw new Error('fixture did not resolve');
        const root = await mkdtemp(join(tmpdir(), 'or3-artifact-'));
        roots.push(root);
        return { client, resolved: resolved.value, payload, digest, staging: join(root, 'package.or3pkg') };
    }

    it('stages the artifact and accepts only the signed digest', async () => {
        const { client, resolved, payload, digest, staging } = await resolvedFixture();
        const downloader = new RegistryClient({
            registryOrigin: ORIGIN,
            trustRoot: {
                releaseKeys: [],
                hostOr3Version: '4.5.1',
                hostPluginApiVersion: '2.0.0',
                acceptedAdvisorySequence: 0,
            },
            maxArtifactBytes: 1024 * 1024,
            reserveBytes: 0,
            freeDiskBytes: async () => 1024 ** 3,
            transport: async () =>
                new Response(payload, {
                    status: 200,
                    headers: { 'content-length': String(payload.byteLength) },
                }),
        });
        void client;
        const result = await downloader.downloadArtifact({ resolved, stagingPath: staging });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.digest).toBe(digest);
        expect(new TextDecoder().decode(await readFile(staging))).toBe('package-bytes');
    });

    it('discards an artifact whose bytes do not match the signed digest', async () => {
        const { resolved, staging, payload } = await resolvedFixture();
        const downloader = new RegistryClient({
            registryOrigin: ORIGIN,
            trustRoot: {
                releaseKeys: [],
                hostOr3Version: '4.5.1',
                hostPluginApiVersion: '2.0.0',
                acceptedAdvisorySequence: 0,
            },
            maxArtifactBytes: 1024 * 1024,
            reserveBytes: 0,
            freeDiskBytes: async () => 1024 ** 3,
            transport: async () => new Response(payload, { status: 200 }),
        });
        // Claim a different archive digest in the resolved document.
        const tampered = {
            ...resolved,
            document: { ...resolved.document, archiveSha256: `sha256-${'f'.repeat(64)}` as const },
        };
        expect(await downloader.downloadArtifact({ resolved: tampered, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'archive-digest-mismatch' },
        });
    });

    it('enforces the byte ceiling while streaming, not from the header', async () => {
        const { resolved, staging } = await resolvedFixture();
        const downloader = new RegistryClient({
            registryOrigin: ORIGIN,
            trustRoot: {
                releaseKeys: [],
                hostOr3Version: '4.5.1',
                hostPluginApiVersion: '2.0.0',
                acceptedAdvisorySequence: 0,
            },
            maxArtifactBytes: 4,
            reserveBytes: 0,
            freeDiskBytes: async () => 1024 ** 3,
            transport: async () =>
                new Response(new Uint8Array(32), {
                    status: 200,
                    // A lying header must not help: 1 byte declared, 32 sent.
                    headers: { 'content-length': '1' },
                }),
        });
        expect(await downloader.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'download-over-limit' },
        });
    });

    it('treats an expired signed URL as retryable so the caller re-resolves', async () => {
        const { resolved, staging } = await resolvedFixture();
        const client = await makeClient({
            keys: [],
            transport: async () => new Response('expired', { status: 403 }),
        });
        expect(await client.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'download-url-expired', retryable: true },
        });
    });

    it('refuses to stage when disk headroom is insufficient', async () => {
        const { resolved, staging } = await resolvedFixture();
        const client = await makeClient({
            keys: [],
            freeDiskBytes: 16,
            transport: async () =>
                new Response(new Uint8Array(8), {
                    status: 200,
                    headers: { 'content-length': '4096' },
                }),
        });
        expect(await client.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'storage-unavailable' },
        });
    });

    it('encoding stays canonical for the signed bytes', () => {
        expect(new TextDecoder().decode(encodeReleaseMetadata({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
    });
});
