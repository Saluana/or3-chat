import { describe, expect, it } from 'vitest';
import {
    canonicalizeReleaseMetadata,
    compareVersions,
    encodeReleaseMetadata,
    evaluateArtifactDigest,
    evaluateArtifactUrl,
    evaluateDownloadBounds,
    evaluateFreshness,
    evaluateReleaseMetadata,
    parseReleaseMetadata,
    RELEASE_METADATA_MAX_AGE_MS,
    releaseMetadataSha256,
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

    it('pins the exact bytes a document encodes to', async () => {
        const encoded = new TextDecoder().decode(encodeReleaseMetadata({ b: 1, a: 2 }));
        expect(encoded).toBe('{"a":2,"b":1}');
        // A frozen digest: if the encoder or the field set changes shape, the
        // signature bytes this host verifies would change too.
        expect(await releaseMetadataSha256({ b: 1, a: 2 })).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    it('compares versions without requiring a semver library', () => {
        expect(compareVersions('4.5.1', '1.0.0')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.0', '1.2.0')).toBeLessThan(0);
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

    it('refuses a document whose signature key is not in the trust root', () => {
        const decision = evaluate({ signature: { keyId: 'unknown', algorithm: 'ed25519', value: 'x' } });
        expect(decision).toMatchObject({ ok: false, refusal: { code: 'release-key-untrusted' } });
    });

    it('refuses an unsigned document and a bad signature', () => {
        const unsigned = evaluate({ signature: undefined });
        expect(unsigned).toMatchObject({ ok: false, refusal: { code: 'release-metadata-unsigned' } });

        const bad = evaluateReleaseMetadata({
            document: document(),
            trustRoot,
            expectation: { pluginId: 'acme.sample' },
            signatureValid: false,
            now: NOW,
        });
        expect(bad).toMatchObject({ ok: false, refusal: { code: 'release-key-untrusted' } });
    });

    it('refuses identity mismatches against what was requested', () => {
        expect(evaluate({}, { pluginId: 'other.plugin' })).toMatchObject({
            ok: false,
            refusal: { code: 'release-identity-mismatch' },
        });
        expect(evaluate({}, { pluginId: 'acme.sample', version: '9.9.9' })).toMatchObject({
            ok: false,
            refusal: { code: 'release-identity-mismatch' },
        });
        expect(evaluate({}, { pluginId: 'acme.sample', releaseId: 'rel_other' })).toMatchObject({
            ok: false,
            refusal: { code: 'release-identity-mismatch' },
        });
    });

    it('refuses profiles this host cannot run and engines it does not satisfy', () => {
        expect(evaluate({ profile: 'or3-future-profile' })).toMatchObject({
            ok: false,
            refusal: { code: 'release-profile-unsupported' },
        });
        expect(evaluate({ engines: { or3: '>=99.0.0', pluginApi: '>=1.0.0' } })).toMatchObject({
            ok: false,
            refusal: { code: 'release-engine-unsupported' },
        });
        expect(evaluate({ engines: { or3: '>=1.0.0', pluginApi: '>=99.0.0' } })).toMatchObject({
            ok: false,
            refusal: { code: 'release-engine-unsupported' },
        });
    });

    it('refuses stale metadata but accepts it within the freshness window', () => {
        const stale = new Date(NOW - RELEASE_METADATA_MAX_AGE_MS - 1000).toISOString();
        expect(evaluate({ publishedAt: stale })).toMatchObject({
            ok: false,
            refusal: { code: 'release-expired' },
        });
        const fresh = new Date(NOW - 60_000).toISOString();
        expect(evaluate({ publishedAt: fresh }).ok).toBe(true);
    });

    it('accepts a document that passes every check', () => {
        const decision = evaluate();
        expect(decision.ok).toBe(true);
        if (!decision.ok) return;
        expect(decision.document.releaseId).toBe('rel_1');
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

    it('refuses an artifact digest that disagrees with the signed metadata', () => {
        expect(
            evaluateArtifactDigest({ expected: `sha256-${'a'.repeat(64)}`, actual: `sha256-${'a'.repeat(64)}` })
        ).toBeNull();
        expect(
            evaluateArtifactDigest({ expected: `sha256-${'a'.repeat(64)}`, actual: `sha256-${'b'.repeat(64)}` })
        ).toMatchObject({ code: 'archive-digest-mismatch' });
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
