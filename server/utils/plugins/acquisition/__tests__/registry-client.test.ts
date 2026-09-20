import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
    encodeReleaseMetadata,
    type AdvisoryDocument,
    type RegistryAdvisorySnapshot,
} from '~~/shared/plugins/acquisition/release-metadata';
import {
    fakeRegistryTransport,
    jsonResponse,
    makeKey,
    ORIGIN,
    PORTABLE_PROFILE,
    releaseFixture,
    tempRoot,
    type TestKey,
} from './fixtures';
import { RegistryClient } from '../registry-client';
import { signAdvisoryForTest, signReleaseMetadataForTest } from '../release-verify';
import {
    computeAuthorityHash,
    type EffectiveAuthority,
} from '~~/shared/plugins/authority/effective-authority';

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function makeClient(options: {
    transport: typeof fetch;
    keys: readonly TestKey['key'][];
    acceptedAdvisorySequence?: number;
    acceptedSecurityRevision?: number;
    acceptedAdvisoryCheckpoint?: {
        revision: number;
        sequence: number;
        snapshotSha256: string;
        issuedAt: string;
        expiresAt: string;
    } | null;
    freeDiskBytes?: number;
    maxArtifactBytes?: number;
    supportedProfiles?: readonly string[];
    registryOrigin?: string;
    /** Release-scoped quarantine ledger, so the scoped-decision path is testable. */
    quarantinedReleases?: () => Readonly<
        Record<
            string,
            { pluginId: string; version: string; sequence: number; reason: string }
        >
    >;
    recordQuarantines?: (
        entries: readonly {
            releaseId: string;
            pluginId: string;
            version: string;
            sequence: number;
            reason: string;
        }[]
    ) => void;
}) {
    const accepted = options.acceptedAdvisorySequence ?? 0;
    return new RegistryClient({
        registryOrigin: options.registryOrigin ?? ORIGIN,
        supportedProfiles: options.supportedProfiles ?? [PORTABLE_PROFILE],
        trustRoot: {
            releaseKeys: [...options.keys],
            supportedProfiles: options.supportedProfiles ?? [PORTABLE_PROFILE],
            hostOr3Version: '0.3.0',
            hostPluginApiVersion: '2.0.0',
            acceptedAdvisorySequence: accepted,
        },
        maxArtifactBytes: options.maxArtifactBytes ?? 8 * 1024 * 1024,
        reserveBytes: 0,
        acceptedAdvisorySequence: accepted,
        ...(options.acceptedSecurityRevision === undefined
            ? {}
            : { acceptedSecurityRevision: options.acceptedSecurityRevision }),
        ...(options.acceptedAdvisoryCheckpoint === undefined
            ? {}
            : { acceptedAdvisoryCheckpoint: options.acceptedAdvisoryCheckpoint }),
        transport: options.transport,
        freeDiskBytes: async () => options.freeDiskBytes ?? 1024 ** 3,
        ...(options.quarantinedReleases
            ? { quarantinedReleases: options.quarantinedReleases }
            : {}),
        ...(options.recordQuarantines
            ? { recordQuarantines: options.recordQuarantines }
            : {}),
        now: () => Date.now(),
    });
}

describe('registry resolve (5.2)', () => {
    it('refuses to resolve when no registry is configured', async () => {
        const client = makeClient({
            keys: [],
            registryOrigin: '',
            transport: async () => jsonResponse({}),
        });
        const result = await client.resolveRelease({
            expectation: { pluginId: 'alpha', version: '1.0.0' },
        });
        expect(result).toMatchObject({ ok: false, failure: { code: 'registry-unconfigured' } });
    });

    it('resolves a signed portable release from the catalog trust path', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const seen: string[] = [];
        const client = makeClient({
            keys: [fixture.key],
            transport: fakeRegistryTransport({ fixture, onRequest: (url) => seen.push(url) }),
        });

        const result = await client.resolveRelease({
            expectation: { pluginId: 'alpha', version: '1.0.0' },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.artifactUrl).toBe(
            `${ORIGIN}/api/v1/catalog/trust/artifacts/${fixture.signed.archiveSha256}`
        );
        expect(result.value.metadataSha256).toMatch(/^sha256-[a-f0-9]{64}$/);
        // The advisory log is always consulted: freshness that is only checked
        // when a caller supplies it is not checked at all.
        expect(seen.some((url) => url.endsWith('/checkpoint'))).toBe(true);
    });

    it('refuses a signed authority descriptor whose digest does not match', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const authority: EffectiveAuthority = {
            trust: 'isolated-client',
            grants: ['network.http'],
            features: [],
            engines: ['or3', 'pluginApi'],
            destinations: [
                { host: 'api.example', methods: ['GET'], pathPrefixes: ['/v1'] },
            ],
            connectionScopes: [],
            dataScopes: ['documents.read'],
            writes: [],
            setupHooks: ['first-action'],
            dependencies: [],
        };
        const digest = await computeAuthorityHash(authority);
        const tamperedAuthority = {
            ...authority,
            destinations: [{ ...authority.destinations[0]!, pathPrefixes: ['/admin'] }],
        };
        const signed = await signReleaseMetadataForTest({
            document: {
                ...fixture.signed,
                authority: tamperedAuthority,
                authoritySha256: digest,
            },
            keyId: fixture.key.keyId,
            privateKeyBase64: fixture.privateKeyBase64,
        });
        const result = await makeClient({
            keys: [fixture.key],
            transport: fakeRegistryTransport({ fixture: { ...fixture, signed } }),
        }).resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } });
        expect(result).toMatchObject({ ok: false, failure: { code: 'authority-mismatch' } });
    });

    it('refuses untrusted keys, tampered documents and wrong profiles', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const other = await makeKey('or3-other-key');
        const transport = fakeRegistryTransport({ fixture });

        // The host trusts a different key, so this document's key is untrusted.
        expect(
            await makeClient({ keys: [other.key], transport }).resolveRelease({
                expectation: { pluginId: 'alpha', version: '1.0.0' },
            })
        ).toMatchObject({ ok: false, failure: { code: 'release-key-untrusted' } });

        // A field changed after signing invalidates the signature.
        const tampered = {
            ...fixture.signed,
            version: '9.9.9',
        };
        const tamperedTransport = fakeRegistryTransport({
            fixture: { ...fixture, signed: tampered },
        });
        expect(
            await makeClient({ keys: [fixture.key], transport: tamperedTransport }).resolveRelease({
                expectation: { pluginId: 'alpha', version: '9.9.9' },
            })
        ).toMatchObject({ ok: false, failure: { code: 'release-key-untrusted' } });

        // A profile this host cannot run is refused, not handed to a loader.
        expect(
            await makeClient({
                keys: [fixture.key],
                transport,
                supportedProfiles: [],
            }).resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-profile-unsupported' } });
    });

    it('refuses identity mismatches, engine mismatches and stale sequences', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const transport = fakeRegistryTransport({ fixture });
        expect(
            await makeClient({ keys: [fixture.key], transport }).resolveRelease({
                expectation: { pluginId: 'acme.other', version: '1.0.0' },
            })
        ).toMatchObject({ ok: false, failure: { code: 'release-identity-mismatch' } });

        const engines = await signReleaseMetadataForTest({
            document: { ...fixture.signed, engines: { or3: '>=99.0.0', pluginApi: '>=1.0.0' } },
            keyId: fixture.key.keyId,
            privateKeyBase64: fixture.privateKeyBase64,
        });
        const engineTransport = fakeRegistryTransport({
            fixture: { ...fixture, signed: engines },
        });
        expect(
            await makeClient({ keys: [fixture.key], transport: engineTransport }).resolveRelease({
                expectation: { pluginId: 'alpha', version: '1.0.0' },
            })
        ).toMatchObject({ ok: false, failure: { code: 'release-engine-unsupported' } });

        const stale = makeClient({
            keys: [fixture.key],
            acceptedAdvisorySequence: 5,
            transport,
        });
        expect(
            await stale.resolveRelease({
                expectation: { pluginId: 'alpha', version: '1.0.0' },
                catalogAdvisorySequence: 4,
                latestAdvisorySequence: 4,
            })
        ).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });
    });

    it('an older catalog cannot clear an accepted quarantine', async () => {
        // The host recorded the advisory position of the signed quarantine. A
        // replayed, older catalog must not be able to clear that block: the
        // signed release metadata carries the catalog position it was published
        // at, and the host refuses anything behind its accepted sequence.
        const fixture = await releaseFixture({ version: '1.0.0' });
        const quarantinedAtSeven = makeClient({
            keys: [fixture.key],
            acceptedAdvisorySequence: 7,
            transport: fakeRegistryTransport({ fixture }),
        });
        expect(
            await quarantinedAtSeven.resolveRelease({
                expectation: { pluginId: 'alpha', version: '1.0.0' },
                catalogAdvisorySequence: 6,
                latestAdvisorySequence: 6,
            })
        ).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });

        // And a catalog at or beyond the accepted position still resolves, so a
        // registry that genuinely withdraws a quarantine is not stuck forever.
        const currentAtSeven = makeClient({
            keys: [fixture.key],
            acceptedAdvisorySequence: 7,
            transport: fakeRegistryTransport({ fixture }),
        });
        expect(
            await currentAtSeven.resolveRelease({
                expectation: { pluginId: 'alpha', version: '1.0.0' },
                catalogAdvisorySequence: 7,
                latestAdvisorySequence: 7,
            })
        ).toMatchObject({ ok: true });
    });

    it('refuses a release the signed advisory log has quarantined', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const advisory = await signAdvisoryForTest({
            document: {
                schemaVersion: 1,
                sequence: 7,
                kind: 'quarantine',
                releaseId: fixture.releaseId,
                pluginId: 'alpha',
                version: '1.0.0',
                archiveSha256: fixture.signed.archiveSha256,
                reason: 'exfiltrates unrelated documents',
                issuedBy: 'or3-marketplace',
                issuedAt: new Date().toISOString(),
            },
            keyId: fixture.key.keyId,
            privateKeyBase64: fixture.privateKeyBase64,
        });
        const client = makeClient({
            keys: [fixture.key],
            transport: fakeRegistryTransport({ fixture, advisories: [advisory] }),
        });
        expect(
            await client.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-quarantined', retryable: false } });
    });

    it('refuses an advisory it cannot verify and records the newest sequence', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const unsigned: AdvisoryDocument = {
            schemaVersion: 1,
            sequence: 9,
            kind: 'notice',
            releaseId: fixture.releaseId,
            pluginId: 'alpha',
            version: '1.0.0',
            archiveSha256: null,
            reason: 'maintenance window',
            issuedBy: 'or3-marketplace',
            issuedAt: new Date().toISOString(),
        };
        const client = makeClient({
            keys: [fixture.key],
            transport: fakeRegistryTransport({ fixture, advisories: [unsigned] }),
        });
        expect(
            await client.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });

        // A verified notice for another release only advances the sequence.
        const otherNotice = await signAdvisoryForTest({
            document: { ...unsigned, sequence: 9, releaseId: 'rel_other', pluginId: 'other' },
            keyId: fixture.key.keyId,
            privateKeyBase64: fixture.privateKeyBase64,
        });
        const fresh = makeClient({
            keys: [fixture.key],
            transport: fakeRegistryTransport({ fixture, advisories: [otherNotice] }),
        });
        const resolved = await fresh.resolveRelease({
            expectation: { pluginId: 'alpha', version: '1.0.0' },
        });
        expect(resolved.ok).toBe(true);
        if (resolved.ok) expect(resolved.value.advisorySequence).toBe(9);
    });

    it('keeps a quarantine after an unrelated advisory advances the cursor', async () => {
        const alpha = await releaseFixture({ version: '1.0.0' });
        const quarantine = await signAdvisoryForTest({
            document: {
                schemaVersion: 1,
                sequence: 7,
                kind: 'quarantine',
                releaseId: alpha.releaseId,
                pluginId: 'alpha',
                version: '1.0.0',
                archiveSha256: alpha.signed.archiveSha256,
                reason: 'exfiltrates unrelated documents',
                issuedBy: 'or3-marketplace',
                issuedAt: new Date().toISOString(),
            },
            keyId: alpha.key.keyId,
            privateKeyBase64: alpha.privateKeyBase64,
        });

        // The host records the decision while resolving alpha.
        const ledger: Record<
            string,
            { pluginId: string; version: string; sequence: number; reason: string }
        > = {};
        const quarantineLedger = {
            quarantinedReleases: () => ledger,
            recordQuarantines: (entries: readonly {
                releaseId: string;
                pluginId: string;
                version: string;
                sequence: number;
                reason: string;
            }[]) => {
                for (const entry of entries) ledger[entry.releaseId] = entry;
            },
        };
        const first = makeClient({
            keys: [alpha.key],
            transport: fakeRegistryTransport({ fixture: alpha, advisories: [quarantine] }),
            ...quarantineLedger,
        });
        expect(
            await first.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-quarantined' } });
        expect(ledger[alpha.releaseId]?.sequence).toBe(7);

        // A later resolve of another release advances the cursor past 7. The
        // registry's log no longer mentions alpha's quarantine at all.
        const otherNotice = await signAdvisoryForTest({
            document: {
                schemaVersion: 1,
                sequence: 9,
                kind: 'notice',
                releaseId: 'rel_other',
                pluginId: 'other',
                version: '2.0.0',
                archiveSha256: null,
                reason: 'maintenance window',
                issuedBy: 'or3-marketplace',
                issuedAt: new Date().toISOString(),
            },
            keyId: alpha.key.keyId,
            privateKeyBase64: alpha.privateKeyBase64,
        });
        const afterCursor = makeClient({
            keys: [alpha.key],
            acceptedAdvisorySequence: 9,
            transport: fakeRegistryTransport({ fixture: alpha, advisories: [otherNotice] }),
            ...quarantineLedger,
        });
        expect(
            await afterCursor.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-quarantined' } });

        // Even with no ledger, a scoped quarantine below the cursor is verified
        // and enforced rather than skipped as history.
        const noLedger = makeClient({
            keys: [alpha.key],
            acceptedAdvisorySequence: 9,
            transport: fakeRegistryTransport({ fixture: alpha, advisories: [quarantine] }),
        });
        expect(
            await noLedger.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-quarantined' } });
    });

    it('refuses an unreadable or missing release', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const notFound = makeClient({
            keys: [fixture.key],
            transport: async () => new Response('missing', { status: 404 }),
        });
        expect(
            await notFound.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-not-found' } });

        const unreadable = makeClient({
            keys: [fixture.key],
            transport: async () => new Response('not json', { status: 200 }),
        });
        expect(
            await unreadable.resolveRelease({
                expectation: { pluginId: 'alpha', version: '1.0.0' },
            })
        ).toMatchObject({ ok: false, failure: { code: 'release-metadata-invalid' } });

        const down = makeClient({
            keys: [fixture.key],
            transport: async () => {
                throw new Error('connection refused');
            },
        });
        expect(
            await down.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'registry-unreachable', retryable: true } });
    });
});

describe('security-state checkpoint acceptance (finding 32)', () => {
    const past = (minutes = 2) => new Date(Date.now() - minutes * 60_000).toISOString();
    const future = (minutes = 20) => new Date(Date.now() + minutes * 60_000).toISOString();
    const digest = (character: string): `sha256-${string}` => `sha256-${character.repeat(64)}`;

    async function resolving(options: {
        /** The fixture the client's transport serves; supplied at each call site. */
        fixture?: Awaited<ReturnType<typeof releaseFixture>>;
        client: Parameters<typeof makeClient>[0];
    }) {
        return await makeClient(options.client).resolveRelease({
            expectation: { pluginId: 'alpha', version: '1.0.0' },
        });
    }

    it('refuses a lower revision (rollback) even when it is otherwise fresh', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const result = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                acceptedSecurityRevision: 5,
                acceptedAdvisoryCheckpoint: {
                    revision: 5,
                    sequence: 9,
                    snapshotSha256: digest('9'),
                    issuedAt: past(),
                    expiresAt: future(60),
                },
                transport: fakeRegistryTransport({ fixture }),
            },
        });
        expect(result).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });
    });

    it('refuses a different digest or an older issue time at the accepted revision', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        // A fixed snapshot so both transports compute the identical digest.
        const snapshot: RegistryAdvisorySnapshot = {
            schemaVersion: 2,
            revision: 1,
            sequence: 9,
            advisories: [],
            keyStatuses: [
                { keyId: fixture.key.keyId, status: 'active', effectiveAt: past() },
            ],
        };
        const baseline = await resolving({
            fixture,
            client: { keys: [fixture.key], transport: fakeRegistryTransport({ fixture, snapshot }) },
        });
        if (!baseline.ok) throw new Error('fixture did not resolve');
        const accepted = {
            revision: baseline.value.advisoryCheckpoint.revision,
            sequence: baseline.value.advisoryCheckpoint.sequence,
            issuedAt: new Date().toISOString(),
            expiresAt: future(60),
        };

        // Same revision, different digest: the registry equivocated.
        const equivocation = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                acceptedSecurityRevision: accepted.revision,
                acceptedAdvisoryCheckpoint: {
                    ...accepted,
                    snapshotSha256: digest('1'),
                },
                transport: fakeRegistryTransport({ fixture, snapshot }),
            },
        });
        expect(equivocation).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });

        // Same revision, same digest, older issue time: a replayed checkpoint.
        const replay = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                acceptedSecurityRevision: accepted.revision,
                acceptedAdvisoryCheckpoint: {
                    ...accepted,
                    snapshotSha256: baseline.value.advisoryCheckpoint.snapshotSha256,
                },
                transport: fakeRegistryTransport({
                    fixture,
                    snapshot,
                    checkpoint: { issuedAt: past(10), expiresAt: future(60) },
                }),
            },
        });
        expect(replay).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });
    });

    it('refuses expired, future-dated and cross-origin checkpoints', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const expired = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    checkpoint: { issuedAt: past(10), expiresAt: past(1) },
                }),
            },
        });
        expect(expired).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });

        const futureDated = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    checkpoint: { issuedAt: future(10), expiresAt: future(20) },
                }),
            },
        });
        expect(futureDated).toMatchObject({ ok: false, failure: { code: 'advisory-stale' } });

        const wrongOrigin = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    checkpoint: { registryOrigin: 'https://other.example' },
                }),
            },
        });
        expect(wrongOrigin).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });
    });

    it('refuses an untrusted or compromised checkpoint signer', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const rogue = await makeKey('or3-rogue-key');
        const untrusted = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({ fixture, checkpointKey: rogue }),
            },
        });
        expect(untrusted).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });

        const compromised = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    keyStatuses: [
                        { keyId: fixture.key.keyId, status: 'compromised', effectiveAt: past() },
                    ],
                }),
            },
        });
        expect(compromised).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });
    });

    it('carries the authenticated checkpoint when a revoked release key refuses the release', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        // A still-trusted checkpoint key signs the snapshot that marks the
        // release-signing key compromised: a compromise sweep in progress.
        const checkpointKey = await makeKey('or3-checkpoint-carrier');
        const refused = await resolving({
            fixture,
            client: {
                keys: [fixture.key, checkpointKey.key],
                transport: fakeRegistryTransport({
                    fixture,
                    checkpointKey,
                    keyStatuses: [
                        { keyId: fixture.key.keyId, status: 'compromised', effectiveAt: past() },
                        {
                            keyId: checkpointKey.key.keyId,
                            status: 'active',
                            effectiveAt: past(),
                        },
                    ],
                }),
            },
        });
        expect(refused).toMatchObject({
            ok: false,
            failure: {
                code: 'release-key-untrusted',
                // The caller must persist this evidence even though the release
                // is refused, or a replayed earlier checkpoint becomes acceptable.
                checkpoint: {
                    revision: 1,
                    sequence: 9,
                    snapshotSha256: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
                },
            },
        });
    });

    it('refuses a tampered digest, duplicate keys and future advisory sequences', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const tampered = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    checkpoint: { snapshotSha256: digest('0') },
                }),
            },
        });
        expect(tampered).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });

        const active = {
            keyId: fixture.key.keyId,
            status: 'active' as const,
            effectiveAt: past(),
        };
        const duplicate = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    snapshot: {
                        schemaVersion: 2,
                        revision: 1,
                        sequence: 9,
                        advisories: [],
                        keyStatuses: [active, { ...active }],
                    },
                }),
            },
        });
        expect(duplicate).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });

        const futureAdvisory = await signAdvisoryForTest({
            document: {
                schemaVersion: 1,
                sequence: 12,
                kind: 'notice',
                releaseId: fixture.releaseId,
                pluginId: 'alpha',
                version: '1.0.0',
                archiveSha256: null,
                reason: 'future',
                issuedBy: 'or3-marketplace',
                issuedAt: past(),
            },
            keyId: fixture.key.keyId,
            privateKeyBase64: fixture.privateKeyBase64,
        });
        const futureSequence = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    snapshot: {
                        schemaVersion: 2,
                        revision: 1,
                        sequence: 9,
                        advisories: [futureAdvisory],
                        keyStatuses: [active],
                    },
                }),
            },
        });
        expect(futureSequence).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });
    });

    it('rejects a schemaVersion 1 checkpoint outright', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const result = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                transport: fakeRegistryTransport({
                    fixture,
                    checkpointResponse: {
                        checkpoint: {
                            schemaVersion: 1,
                            registryOrigin: ORIGIN,
                            sequence: 9,
                            issuedAt: past(),
                            expiresAt: future(60),
                            snapshotSha256: digest('a'),
                            signature: {
                                keyId: fixture.key.keyId,
                                algorithm: 'ed25519',
                                value: 'legacy',
                            },
                        },
                        snapshot: {
                            schemaVersion: 1,
                            sequence: 9,
                            advisories: [],
                            keyStatuses: [
                                { keyId: fixture.key.keyId, status: 'active', effectiveAt: past() },
                            ],
                        },
                    },
                }),
            },
        });
        expect(result).toMatchObject({ ok: false, failure: { code: 'advisory-unverified' } });
    });

    it('accepts a strictly higher revision and threads it into the release', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const result = await resolving({
            fixture,
            client: {
                keys: [fixture.key],
                acceptedSecurityRevision: 3,
                acceptedAdvisoryCheckpoint: {
                    revision: 3,
                    sequence: 9,
                    snapshotSha256: digest('3'),
                    issuedAt: past(10),
                    expiresAt: future(60),
                },
                transport: fakeRegistryTransport({
                    fixture,
                    snapshot: {
                        schemaVersion: 2,
                        revision: 4,
                        sequence: 9,
                        advisories: [],
                        keyStatuses: [
                            { keyId: fixture.key.keyId, status: 'active', effectiveAt: past() },
                        ],
                    },
                }),
            },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.advisoryCheckpoint).toMatchObject({ revision: 4, sequence: 9 });
        expect(result.value.advisorySequence).toBe(9);
    });
});

describe('artifact download (5.2)', () => {
    async function resolvedFixture() {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const client = makeClient({
            keys: [fixture.key],
            transport: fakeRegistryTransport({ fixture }),
        });
        const resolved = await client.resolveRelease({
            expectation: { pluginId: 'alpha', version: '1.0.0' },
        });
        if (!resolved.ok) throw new Error('fixture did not resolve');
        const staging = `${tempRoot('or3-artifact-')}/package.or3pkg`;
        return { client, resolved: resolved.value, fixture, staging };
    }

    async function downloader(options: {
        fixture: Awaited<ReturnType<typeof releaseFixture>>;
        failDownload?: () => boolean;
        ignoreRange?: boolean;
        freeDiskBytes?: number;
        maxArtifactBytes?: number;
    }) {
        return makeClient({
            keys: [],
            maxArtifactBytes: options.maxArtifactBytes ?? 8 * 1024 * 1024,
            freeDiskBytes: options.freeDiskBytes,
            transport: fakeRegistryTransport({
                fixture: options.fixture,
                failDownload: options.failDownload,
                ignoreRange: options.ignoreRange,
            }),
        });
    }

    it('stages the artifact and accepts only the signed digest', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = await downloader({ fixture });
        const result = await client.downloadArtifact({ resolved, stagingPath: staging });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.digest).toBe(fixture.signed.archiveSha256);
    });

    it('restarts from scratch when the registry ignores a Range request', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = await downloader({ fixture });
        const first = await client.downloadArtifact({ resolved, stagingPath: staging });
        expect(first.ok).toBe(true);

        // The server answers 200 to a resume; the prefix is discarded and the
        // full body is consumed instead of retrying the same request forever.
        const ignoring = await downloader({ fixture, ignoreRange: true });
        const second = await ignoring.downloadArtifact({
            resolved,
            stagingPath: staging,
            resumeFromBytes: 4,
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.value.digest).toBe(fixture.signed.archiveSha256);
        expect(second.value.bytes).toBe(fixture.bytes.byteLength);
    });

    it('discards an artifact whose bytes do not match the signed digest', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = await downloader({ fixture });
        const tampered = {
            ...resolved,
            document: {
                ...resolved.document,
                archiveSha256: `sha256-${'f'.repeat(64)}` as const,
            },
        };
        expect(await client.downloadArtifact({ resolved: tampered, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'archive-digest-mismatch' },
        });
    });

    it('enforces the byte ceiling while streaming, not from the header', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = await downloader({ fixture, maxArtifactBytes: 4 });
        expect(await client.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'download-over-limit' },
        });
    });

    it('treats an expired signed URL as retryable so the caller re-resolves', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = makeClient({
            keys: [],
            transport: async () => new Response('expired', { status: 403 }),
        });
        void fixture;
        expect(await client.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'download-url-expired', retryable: true },
        });
    });

    it('distinguishes a paid-release refusal so the caller can use a Library link', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = makeClient({
            keys: [],
            transport: async () =>
                new Response(
                    JSON.stringify({
                        statusCode: 403,
                        statusMessage: 'coverage-required',
                        data: { code: 'coverage-required' },
                    }),
                    { status: 403, headers: { 'content-type': 'application/json' } }
                ),
        });
        void fixture;
        expect(await client.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'coverage-required', retryable: true },
        });
    });

    it('sends caller-provided headers with the artifact request', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const seen: Record<string, string>[] = [];
        const client = makeClient({
            keys: [],
            transport: async (_input, init) => {
                seen.push((init?.headers as Record<string, string>) ?? {});
                return new Response(new Uint8Array(fixture.bytes), { status: 200 });
            },
        });
        const result = await client.downloadArtifact({
            resolved,
            stagingPath: staging,
            headers: { 'x-or3-library-token': 'linked-token' },
        });
        expect(result.ok).toBe(true);
        expect(seen[0]?.['x-or3-library-token']).toBe('linked-token');
    });

    it('refuses to stage when the free-space budget cannot cover staging and extraction', async () => {
        const { resolved, fixture, staging } = await resolvedFixture();
        const client = await downloader({ fixture, freeDiskBytes: 16 });
        expect(await client.downloadArtifact({ resolved, stagingPath: staging })).toMatchObject({
            ok: false,
            failure: { code: 'storage-unavailable' },
        });
    });

    it('encoding stays canonical for the signed bytes', () => {
        expect(new TextDecoder().decode(encodeReleaseMetadata({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
    });
});
