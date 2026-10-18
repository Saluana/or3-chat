import { describe, expect, it } from 'vitest';
import {
    canonicalizeReleaseMetadata,
    encodeReleaseMetadata,
    evaluateArtifactUrl,
    evaluateClientEngineSupport,
    evaluateDownloadBounds,
    evaluateFreshness,
    evaluateReleaseMetadata,
    parseReleaseMetadata,
    supportedAcquisitionProfiles,
    type RegistryTrustRoot,
    type ReleaseMetadataDocument,
} from '../release-metadata';

const NOW = Date.parse('2026-09-17T00:00:00.000Z');

function document(overrides: Partial<ReleaseMetadataDocument> = {}): ReleaseMetadataDocument {
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
        publishedAt: '2026-09-01T00:00:00.000Z',
        signature: { keyId: 'or3-release', algorithm: 'ed25519', value: 'c2ln' },
        ...overrides,
    };
}

const trustRoot: RegistryTrustRoot = {
    registryOrigin: 'https://market.example',
    releaseKeys: [
        { keyId: 'or3-release', publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'x' } },
    ],
    supportedProfiles: ['or3-portable-client-v1'],
    hostOr3Version: '4.5.1',
    hostPluginApiVersion: '2.0.0',
    acceptedAdvisorySequence: 0,
};

function evaluate(
    overrides: Partial<ReleaseMetadataDocument> = {},
    expectation: { pluginId: string; version?: string; releaseId?: string } = { pluginId: 'acme.sample' }
) {
    return evaluateReleaseMetadata({
        document: document(overrides),
        trustRoot,
        expectation,
        signatureValid: true,
        now: NOW,
    });
}

describe('release metadata encoding (5.2)', () => {
    it('canonicalizes keys and drops undefined, so signatures are reproducible', () => {
        const canonical = canonicalizeReleaseMetadata({
            b: 1,
            a: { d: 2, c: 3 },
            skip: undefined,
            list: [{ z: 1, y: 2 }],
        });
        expect(JSON.stringify(canonical)).toBe(
            '{"a":{"c":3,"d":2},"b":1,"list":[{"y":2,"z":1}]}'
        );
    });

    it('pins the exact bytes a document encodes to', () => {
        const encoded = new TextDecoder().decode(encodeReleaseMetadata({ b: 1, a: 2 }));
        expect(encoded).toBe('{"a":2,"b":1}');
    });

});

describe('release metadata validation (5.2)', () => {
    it('accepts a well-formed document and refuses malformed ones', () => {
        const parsed = parseReleaseMetadata(document());
        expect(parsed.problems).toEqual([]);
        expect(parsed.document?.pluginId).toBe('acme.sample');

        const missing = parseReleaseMetadata({ ...document(), archiveSha256: 'sha256-nope' });
        expect(missing.document).toBeNull();
        expect(missing.problems.join(' ')).toContain('archiveSha256');

        const traversal = parseReleaseMetadata({ ...document(), pluginId: '../escape' });
        expect(traversal.document).toBeNull();
        expect(traversal.problems.join(' ')).toContain('pluginId');
    });

    it('accepts an old but intact release: age is not freshness', () => {
        // Quarantine decisions come from the signed advisory log, so a release
        // published long ago is not refused for being old.
        const old = new Date(NOW - 400 * 24 * 60 * 60 * 1000).toISOString();
        expect(evaluate({ publishedAt: old }).ok).toBe(true);
    });

});

describe('freshness and bounds (5.2)', () => {
    it('refuses a catalog or advisory sequence that moved backwards', () => {
        expect(
            evaluateFreshness({
                hostAcceptedAdvisorySequence: 4,
                catalogAdvisorySequence: 3,
                latestAdvisorySequence: 4,
            })
        ).toMatchObject({ code: 'advisory-stale' });
        expect(
            evaluateFreshness({
                hostAcceptedAdvisorySequence: 4,
                catalogAdvisorySequence: 4,
                latestAdvisorySequence: 3,
            })
        ).toMatchObject({ code: 'advisory-stale' });
        expect(
            evaluateFreshness({
                hostAcceptedAdvisorySequence: 4,
                catalogAdvisorySequence: 4,
                latestAdvisorySequence: 4,
            })
        ).toBeNull();
    });

    it('refuses a download that exceeds the ceiling or the disk headroom', () => {
        expect(
            evaluateDownloadBounds({
                declaredBytes: 33 * 1024 * 1024,
                bounds: { maxBytes: 32 * 1024 * 1024, remainingDiskBytes: 1024 ** 3, reserveBytes: 0 },
            })
        ).toMatchObject({ ok: false, refusal: { code: 'download-over-limit' } });

        expect(
            evaluateDownloadBounds({
                declaredBytes: 1024,
                bounds: { maxBytes: 32 * 1024 * 1024, remainingDiskBytes: 2048, reserveBytes: 4096 },
            })
        ).toMatchObject({ ok: false, refusal: { code: 'storage-unavailable' } });

        expect(
            evaluateDownloadBounds({
                declaredBytes: 1024,
                bounds: { maxBytes: 32 * 1024 * 1024, remainingDiskBytes: 1024 ** 3, reserveBytes: 0 },
            })
        ).toEqual({ ok: true });
    });

    it('refuses artifact URLs that are not same-origin HTTPS on the registry', () => {
        const registry = 'https://market.example';
        expect(evaluateArtifactUrl({ url: 'https://market.example/artifacts/x', registryOrigin: registry })).toBeNull();
        expect(evaluateArtifactUrl({ url: 'http://market.example/x', registryOrigin: registry })).toMatchObject({
            code: 'download-url-invalid',
        });
        expect(evaluateArtifactUrl({ url: 'https://evil.example/x', registryOrigin: registry })).toMatchObject({
            code: 'download-url-invalid',
        });
        expect(evaluateArtifactUrl({ url: 'not a url', registryOrigin: registry })).toMatchObject({
            code: 'download-url-invalid',
        });
        expect(
            evaluateArtifactUrl({ url: 'https://market.example.evil.example/x', registryOrigin: registry })
        ).toMatchObject({ code: 'download-url-invalid' });
    });
});

describe('client engine qualification (finding 12)', () => {
    const qualified = ['chromium'];

    it('requires a qualified engine only for profiles that need a client runtime', () => {
        expect(
            evaluateClientEngineSupport({
                profile: 'or3-portable-client-v1',
                engine: 'chromium',
                qualifiedEngines: qualified,
            })
        ).toEqual({ required: true, supported: true });
        for (const engine of ['firefox', 'webkit', 'unknown', '', null, undefined]) {
            expect(
                evaluateClientEngineSupport({
                    profile: 'or3-portable-client-v1',
                    engine,
                    qualifiedEngines: qualified,
                })
            ).toEqual({ required: true, supported: false });
        }
    });

    it('does not browser-scope a profile with no client runtime requirement', () => {
        expect(
            evaluateClientEngineSupport({
                profile: 'or3-trusted-host-v1',
                engine: 'unknown',
                qualifiedEngines: qualified,
            })
        ).toEqual({ required: false, supported: true });
    });

    it('requires the browser canary for a signed trusted-host client release', () => {
        expect(supportedAcquisitionProfiles(['trusted-host'])).toContain('or3-trusted-host-v2');
        expect(evaluateClientEngineSupport({
            profile: 'or3-trusted-host-v2', engine: 'unknown', qualifiedEngines: qualified,
        })).toEqual({ required: true, supported: false });
    });
});
