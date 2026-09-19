/**
 * @module server/utils/plugins/acquisition/registry-client
 *
 * Purpose:
 * Resolve a reviewed release from the configured registry and stage its artifact
 * locally, verifying signatures, freshness and digests before anything can be
 * activated.
 *
 * Behavior:
 * - Only the configured registry origin is contacted; a release identifies the
 *   release, not a URL, so arbitrary package URLs are structurally impossible.
 * - The metadata document is signature-verified against the host trust root with
 *   the exact canonical bytes, then policy-checked (identity, profile, engines,
 *   freshness, size) before the artifact is fetched.
 * - The artifact streams to a staging file with a byte ceiling and an incremental
 *   digest; the digest must equal the signed archive digest or the download is
 *   discarded.
 * - A partial download is kept with its byte count so an interrupted operation
 *   resumes instead of restarting, and an expired URL is re-resolved.
 *
 * Constraints:
 * - No plugin code runs here, and nothing is installed until promotion.
 * - Signed download URLs are never logged or persisted.
 *
 * Non-Goals:
 * - Candidate verification, health checks and promotion (existing services own
 *   those and the acquisition service wraps them).
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256Identity } from '~~/shared/plugins/digest';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';
import {
    encodeRegistryAdvisorySnapshot,
    evaluateAdvisories,
    encodeReleaseMetadata,
    evaluateArtifactDigest,
    evaluateArtifactUrl,
    evaluateDownloadBounds,
    evaluateFreshness,
    evaluateReleaseMetadata,
    findApplicableQuarantine,
    parseAdvisoryDocument,
    parseReleaseMetadata,
    recordedQuarantineRefusal,
    type RegistryTrustRoot,
    type ReleaseMetadataDocument,
    type ReleaseMetadataExpectation,
    type ReleaseMetadataRefusal,
    type RegistryAdvisoryCheckpoint,
    type RegistryAdvisorySnapshot,
    type AdvisoryDocument,
} from '~~/shared/plugins/acquisition/release-metadata';
import { computeAuthorityHash } from '~~/shared/plugins/authority/effective-authority';
import {
    verifyAdvisorySignature,
    verifyRegistryAdvisoryCheckpointSignature,
    verifyReleaseMetadataSignature,
} from './release-verify';
import type { AcceptedAdvisoryCheckpoint } from './registry-state';

export interface RegistryClientOptions {
    readonly registryOrigin: string;
    /** Profiles the host can run; a signed profile outside this set is refused. */
    readonly supportedProfiles: readonly string[];
    readonly trustRoot: Omit<RegistryTrustRoot, 'registryOrigin'>;
    readonly maxArtifactBytes: number;
    /** Free-space headroom kept for the running instance while staging. */
    readonly reserveBytes: number;
    readonly requestTimeoutMs?: number;
    readonly transport?: typeof fetch;
    /** Reads remaining disk space for the staging filesystem. */
    readonly freeDiskBytes?: (path: string) => Promise<number>;
    /** Highest advisory sequence already accepted by this host. Defaults to 0. */
    readonly acceptedAdvisorySequence?: number;
    readonly acceptedAdvisoryCheckpoint?: AcceptedAdvisoryCheckpoint | null;
    /**
     * Release-scoped quarantine decisions this host already recorded. Read live
     * so a decision made by another resolve is visible here immediately, and
     * consulted independently of the advisory cursor.
     */
    readonly quarantinedReleases?: () =>
        | Readonly<
              Record<
                  string,
                  {
                      readonly pluginId: string;
                      readonly version: string;
                      readonly sequence: number;
                      readonly reason: string;
                  }
              >
          >
        | Promise<
              Readonly<
                  Record<
                      string,
                      {
                          readonly pluginId: string;
                          readonly version: string;
                          readonly sequence: number;
                          readonly reason: string;
                      }
                  >
              >
          >;
    /** Persist verified quarantine decisions for individual releases. */
    readonly recordQuarantines?: (
        entries: readonly {
            readonly releaseId: string;
            readonly pluginId: string;
            readonly version: string;
            readonly sequence: number;
            readonly reason: string;
        }[]
    ) => Promise<void> | void;
    readonly now?: () => number;
    /** Maximum age accepted for the signed complete advisory checkpoint. */
    readonly advisoryCheckpointMaxAgeMs?: number;
}

export type RegistryFailureCode =
    | 'registry-unconfigured'
    | 'registry-unreachable'
    | 'release-not-found'
    | 'release-metadata-invalid'
    | 'release-metadata-unsigned'
    | 'release-key-untrusted'
    | 'release-identity-mismatch'
    | 'release-digest-mismatch'
    | 'authority-mismatch'
    | 'release-profile-unsupported'
    | 'release-expired'
    | 'release-engine-unsupported'
    | 'catalog-stale'
    | 'advisory-stale'
    | 'advisory-unverified'
    | 'release-quarantined'
    | 'download-url-invalid'
    | 'download-url-expired'
    | 'coverage-required'
    | 'download-over-limit'
    | 'download-failed'
    | 'storage-unavailable'
    | 'archive-digest-mismatch'
    | 'internal-error';

export interface RegistryFailure {
    readonly code: RegistryFailureCode;
    readonly message: string;
    readonly retryable: boolean;
}

export type RegistryResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly failure: RegistryFailure };

export interface ResolvedRelease {
    readonly document: ReleaseMetadataDocument;
    readonly metadataSha256: Sha256;
    /**
     * Same-origin artifact URL. It is derived from the signed archive digest (the
     * registry layout is content-addressed), never from a caller-supplied URL.
     */
    readonly artifactUrl: string;
    readonly advisorySequence: number;
    /** Signed checkpoint that authorized the release, for resume revalidation. */
    readonly advisoryCheckpoint: {
        readonly sequence: number;
        readonly snapshotSha256: Sha256;
        readonly issuedAt: string;
        readonly expiresAt: string;
    };
}

function failure(code: RegistryFailureCode, message: string, retryable = false): {
    ok: false;
    failure: RegistryFailure;
} {
    return { ok: false, failure: { code, message, retryable } };
}

function refusalToFailure(refusal: ReleaseMetadataRefusal): {
    ok: false;
    failure: RegistryFailure;
} {
    const retryable = refusal.code === 'advisory-stale' || refusal.code === 'catalog-stale';
    return failure(refusal.code as RegistryFailureCode, refusal.message, retryable);
}

function joinOrigin(origin: string, path: string): string {
    return `${origin.replace(/\/$/, '')}${path}`;
}

/**
 * A refusal body is bounded and optional: an expired signed URL usually answers
 * without one, and a paid release answers `coverage-required` so the host can
 * route the download through the linked Library instead of retrying a public
 * URL that will never serve it.
 */
async function readRefusalCode(response: Response): Promise<string | null> {
    try {
        const text = (await response.text()).slice(0, 2048);
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') return null;
        const record = parsed as { data?: unknown; statusMessage?: unknown };
        const data =
            record.data && typeof record.data === 'object'
                ? (record.data as { code?: unknown })
                : null;
        if (typeof data?.code === 'string') return data.code;
        if (typeof record.statusMessage === 'string') return record.statusMessage;
        return null;
    } catch {
        return null;
    }
}

export class RegistryClient {
    readonly #options: RegistryClientOptions;
    readonly #fetch: typeof fetch;
    readonly #now: () => number;

    constructor(options: RegistryClientOptions) {
        this.#options = options;
        this.#fetch = options.transport ?? fetch;
        this.#now = options.now ?? (() => Date.now());
    }

    #acceptedAdvisorySequence(): number {
        return this.#options.acceptedAdvisorySequence ?? 0;
    }

    #configured(): boolean {
        return (
            this.#options.registryOrigin.startsWith('https://') &&
            this.#options.trustRoot.releaseKeys.length > 0
        );
    }

    async #getJson(path: string): Promise<RegistryResult<unknown>> {
        const url = joinOrigin(this.#options.registryOrigin, path);
        let response: Response;
        try {
            response = await this.#fetch(url, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(this.#options.requestTimeoutMs ?? 10_000),
                redirect: 'error',
            });
        } catch (error) {
            return failure(
                'registry-unreachable',
                `The registry could not be reached: ${error instanceof Error ? error.message : 'unknown error'}`,
                true
            );
        }
        if (response.status === 404) {
            return failure('release-not-found', 'The registry has no such release.');
        }
        if (!response.ok) {
            return failure(
                'registry-unreachable',
                `The registry answered ${response.status}.`,
                response.status >= 500
            );
        }
        try {
            return { ok: true, value: (await response.json()) as unknown };
        } catch {
            return failure('release-metadata-invalid', 'The registry returned an unreadable document.');
        }
    }

    /**
     * Resolve release metadata for a plugin/version (or an exact release id),
     * verify its signature against the trust root, and check freshness and policy.
     */
    async resolveRelease(input: {
        readonly expectation: ReleaseMetadataExpectation;
        readonly catalogAdvisorySequence?: number;
        readonly latestAdvisorySequence?: number;
    }): Promise<RegistryResult<ResolvedRelease>> {
        if (!this.#configured()) {
            return failure(
                'registry-unconfigured',
                'No marketplace registry origin or release key is configured on this instance.'
            );
        }

        const version = input.expectation.version;
        if (version === undefined) {
            return failure(
                'release-metadata-invalid',
                'A registry release is addressed by plugin id and version.'
            );
        }
        // The marketplace addresses releases by plugin id and version; a
        // re-resolution after a restart resolves the same way and the returned
        // release id is then checked against the recorded one.
        const path = `/api/v1/catalog/trust/releases/${encodeURIComponent(
            input.expectation.pluginId
        )}/${encodeURIComponent(version)}/metadata`;

        const fetched = await this.#getJson(path);
        if (!fetched.ok) return fetched;

        const parsed = parseReleaseMetadata(unwrapMetadataDocument(fetched.value));
        if (!parsed.document) {
            return failure(
                'release-metadata-invalid',
                `The registry returned invalid release metadata: ${parsed.problems.join('; ')}`
            );
        }

        const signatureValid = await verifyReleaseMetadataSignature({
            document: parsed.document,
            trustRoot: this.#options.trustRoot.releaseKeys,
        });

        const decision = evaluateReleaseMetadata({
            document: parsed.document,
            trustRoot: {
                ...this.#options.trustRoot,
                registryOrigin: this.#options.registryOrigin,
                supportedProfiles: this.#options.supportedProfiles,
            },
            expectation: input.expectation,
            signatureValid,
            now: this.#now(),
        });
        if (!decision.ok) return refusalToFailure(decision.refusal);

        // A published authority descriptor is the reviewable form of the
        // authority hash. When present it must hash to the signed digest; a
        // mismatched descriptor is never shown for consent. Older free releases
        // may omit it, in which case no opaque authority can be approved by the UI.
        if (parsed.document.authority !== undefined) {
            let authorityDigest: Sha256;
            try {
                authorityDigest = await computeAuthorityHash(parsed.document.authority);
            } catch {
                return failure('authority-mismatch', 'The signed authority descriptor is invalid.');
            }
            if (authorityDigest !== parsed.document.authoritySha256) {
                return failure(
                    'authority-mismatch',
                    'The signed authority descriptor does not match its authority digest.'
                );
            }
        }

        if (
            input.catalogAdvisorySequence !== undefined &&
            input.latestAdvisorySequence !== undefined
        ) {
            const freshness = evaluateFreshness({
                hostAcceptedAdvisorySequence: this.#acceptedAdvisorySequence(),
                catalogAdvisorySequence: input.catalogAdvisorySequence,
                latestAdvisorySequence: input.latestAdvisorySequence,
            });
            if (freshness) return refusalToFailure(freshness);
        }

        // The complete signed checkpoint decides whether this exact release is
        // still acquirable. Unsigned index summaries are discovery hints only
        // and are never used to select which advisory documents to verify.
        const advisories = await this.#verifyAdvisories(parsed.document);
        if (!advisories.ok) return advisories;
        if (!advisories.value.trustedKeyIds.includes(parsed.document.signature?.keyId ?? '')) {
            return failure(
                'release-key-untrusted',
                'The signing key for this release is not explicitly trusted at the current registry checkpoint.'
            );
        }

        const metadataSha256 = await releaseMetadataDigest(parsed.document);
        const artifact = this.#artifactReference(parsed.document.archiveSha256);
        if (!artifact.ok) return artifact;

        return {
            ok: true,
            value: {
                document: parsed.document,
                metadataSha256,
                artifactUrl: artifact.url,
                advisorySequence: advisories.value.sequence,
                advisoryCheckpoint: advisories.value.checkpoint,
            },
        };
    }

    /**
     * Fetch the public signed advisory log, verify the advisories that apply to
     * this release, and refuse when one quarantines it. The newest sequence seen
     * is returned so the host can record it monotonically.
     *
     * Quarantine decisions are release-scoped, so they are evaluated against the
     * host's recorded decisions and against *every* applicable entry - including
     * ones at or below the advisory cursor, which only measures freshness.
     */
    async #verifyAdvisories(
        document: ReleaseMetadataDocument
    ): Promise<
        RegistryResult<{
            readonly sequence: number;
            readonly checkpoint: {
                readonly sequence: number;
                readonly snapshotSha256: Sha256;
                readonly issuedAt: string;
                readonly expiresAt: string;
            };
            readonly revokedKeyIds: readonly string[];
            readonly trustedKeyIds: readonly string[];
        }>
    > {
        // A quarantine this host already recorded still applies even if the
        // registry's current log no longer lists it.
        const ledger = await this.#options.quarantinedReleases?.();
        const recorded = ledger?.[document.releaseId];
        if (recorded) return refusalToFailure(recordedQuarantineRefusal(recorded));

        const fetched = await this.#getJson('/api/v1/catalog/trust/checkpoint');
        if (!fetched.ok) return fetched;
        const parsedCheckpoint = parseCheckpointResponse(fetched.value);
        if (!parsedCheckpoint) {
            return failure(
                'advisory-unverified',
                'The registry returned an unreadable signed advisory checkpoint.'
            );
        }
        const { checkpoint, snapshot } = parsedCheckpoint;
        if (checkpoint.registryOrigin !== this.#options.registryOrigin) {
            return failure(
                'advisory-unverified',
                'The advisory checkpoint belongs to a different registry.'
            );
        }
        const now = this.#now();
        const issuedAt = Date.parse(checkpoint.issuedAt);
        const expiresAt = Date.parse(checkpoint.expiresAt);
        const maxAge = this.#options.advisoryCheckpointMaxAgeMs ?? 24 * 60 * 60 * 1000;
        if (
            !Number.isFinite(issuedAt) ||
            !Number.isFinite(expiresAt) ||
            issuedAt > now + 5 * 60 * 1000 ||
            expiresAt <= now ||
            expiresAt <= issuedAt ||
            now - issuedAt > maxAge
        ) {
            return failure(
                'advisory-stale',
                'The registry advisory checkpoint is expired or outside the freshness window.'
            );
        }
        if (checkpoint.sequence < this.#acceptedAdvisorySequence()) {
            return failure(
                'advisory-stale',
                `Advisory sequence ${checkpoint.sequence} is lower than the accepted sequence ${this.#acceptedAdvisorySequence()}.`
            );
        }
        const acceptedCheckpoint = this.#options.acceptedAdvisoryCheckpoint;
        if (
            acceptedCheckpoint &&
            checkpoint.sequence === acceptedCheckpoint.sequence &&
            (checkpoint.snapshotSha256 !== acceptedCheckpoint.snapshotSha256 ||
                Date.parse(checkpoint.issuedAt) < Date.parse(acceptedCheckpoint.issuedAt))
        ) {
            return failure(
                checkpoint.snapshotSha256 !== acceptedCheckpoint.snapshotSha256
                    ? 'advisory-unverified'
                    : 'advisory-stale',
                checkpoint.snapshotSha256 !== acceptedCheckpoint.snapshotSha256
                    ? 'The registry presented two different advisory snapshots at one sequence.'
                    : 'The registry replayed an older advisory checkpoint at the accepted sequence.'
            );
        }
        if (!(await verifyRegistryAdvisoryCheckpointSignature({
            checkpoint,
            trustRoot: this.#options.trustRoot.releaseKeys,
        }))) {
            return failure(
                'advisory-unverified',
                'The registry advisory checkpoint is not signed by a trusted release key.'
            );
        }
        if (snapshot.sequence !== checkpoint.sequence) {
            return failure('advisory-unverified', 'The advisory snapshot sequence does not match its checkpoint.');
        }
        const snapshotDigest = await sha256Identity(encodeRegistryAdvisorySnapshot(snapshot));
        if (snapshotDigest !== checkpoint.snapshotSha256) {
            return failure('advisory-unverified', 'The advisory snapshot digest does not match its checkpoint.');
        }
        const seenSequences = new Set<number>();
        const keyStatuses = new Map(snapshot.keyStatuses.map((key) => [key.keyId, key.status]));
        const revokedKeyIds = snapshot.keyStatuses
            .filter((key) => key.status === 'compromised')
            .map((key) => key.keyId);
        const trustedKeyIds = snapshot.keyStatuses
            .filter((key) => key.status === 'active' || key.status === 'retired')
            .map((key) => key.keyId);
        if (keyStatuses.size !== snapshot.keyStatuses.length) {
            return failure('advisory-unverified', 'The advisory checkpoint contains duplicate signing keys.');
        }
        if (keyStatuses.get(checkpoint.signature.keyId) !== 'active') {
            return failure('advisory-unverified', 'The advisory checkpoint signer is not explicitly active.');
        }
        const accepted = this.#acceptedAdvisorySequence();
        const parsedAdvisories = [];
        for (const advisory of snapshot.advisories) {
            if (seenSequences.has(advisory.sequence) || advisory.sequence > checkpoint.sequence) {
                return failure(
                    'advisory-unverified',
                    'The advisory snapshot contains duplicate or future sequence values.'
                );
            }
            seenSequences.add(advisory.sequence);
            const signatureValid = await verifyAdvisorySignature({
                document: advisory,
                trustRoot: this.#options.trustRoot.releaseKeys,
            });
            if (
                !signatureValid ||
                !this.#options.trustRoot.releaseKeys.some(
                    (key) =>
                        key.keyId === advisory.signature?.keyId &&
                        (keyStatuses.get(key.keyId) === 'active' ||
                            keyStatuses.get(key.keyId) === 'retired')
                )
            ) {
                return failure(
                    'advisory-unverified',
                    `Advisory ${advisory.sequence} is not signed by a trusted release key.`
                );
            }
            parsedAdvisories.push(advisory);
        }

        // Scoped quarantine decision over every verified advisory, recorded before
        // the refusal returns so a later resolve of this release still sees it.
        const quarantine = findApplicableQuarantine({
            advisories: parsedAdvisories,
            releaseId: document.releaseId,
            pluginId: document.pluginId,
            version: document.version,
        });
        if (quarantine) {
            await this.#options.recordQuarantines?.([quarantine]);
            return refusalToFailure(recordedQuarantineRefusal(quarantine));
        }

        const decision = evaluateAdvisories({
            advisories: parsedAdvisories,
            hostAcceptedAdvisorySequence: accepted,
            releaseId: document.releaseId,
            pluginId: document.pluginId,
            version: document.version,
        });
        const latest = Math.max(decision.latestSequence, checkpoint.sequence, accepted);
        if (decision.refusal) return refusalToFailure(decision.refusal);
        return {
            ok: true,
            value: {
                sequence: latest,
                checkpoint: {
                    sequence: checkpoint.sequence,
                    snapshotSha256: checkpoint.snapshotSha256,
                    issuedAt: checkpoint.issuedAt,
                    expiresAt: checkpoint.expiresAt,
                },
                revokedKeyIds,
                trustedKeyIds,
            },
        };
    }

    /**
     * The artifact is content-addressed by the signed archive digest, so its URL
     * is derived here rather than taken from anything the caller or the document
     * says. Only same-origin HTTPS is accepted.
     */
    #artifactReference(digest: Sha256): { ok: true; url: string } | { ok: false; failure: RegistryFailure } {
        const url = joinOrigin(
            this.#options.registryOrigin,
            `/api/v1/catalog/trust/artifacts/${encodeURIComponent(digest)}`
        );
        const refusal = evaluateArtifactUrl({ url, registryOrigin: this.#options.registryOrigin });
        if (refusal) return failure(refusal.code as RegistryFailureCode, refusal.message);
        return { ok: true, url };
    }

    /**
     * Stream an artifact into `stagingPath`, enforcing the byte ceiling and
     * computing its digest as it goes. On any failure the partial bytes and their
     * count are kept so a retry can resume; only a verified digest is accepted.
     */
    async downloadArtifact(input: {
        readonly resolved: ResolvedRelease;
        readonly stagingPath: string;
        readonly resumeFromBytes?: number;
        readonly signal?: AbortSignal;
        /** Extra request headers, for a linked Library artifact download. */
        readonly headers?: Readonly<Record<string, string>>;
    }): Promise<
        RegistryResult<{ readonly bytes: number; readonly digest: Sha256; readonly path: string }>
    > {
        const resumeFrom = input.resumeFromBytes ?? 0;

        await fs.mkdir(dirname(input.stagingPath), { recursive: true, mode: 0o700 });

        let response: Response;
        try {
            response = await this.#fetch(input.resolved.artifactUrl, {
                headers: {
                    ...(resumeFrom > 0
                        ? { range: `bytes=${resumeFrom}-`, accept: 'application/octet-stream' }
                        : { accept: 'application/octet-stream' }),
                    ...(input.headers ?? {}),
                },
                signal: input.signal ?? AbortSignal.timeout(10 * 60_000),
                redirect: 'error',
            });
        } catch (error) {
            return failure(
                'download-failed',
                `The artifact could not be fetched: ${error instanceof Error ? error.message : 'unknown error'}`,
                true
            );
        }

        if (response.status === 403 || response.status === 401) {
            // A paid release refuses the public path with a distinguishable body;
            // the caller can then acquire through the linked Library. Anything
            // else is an expired signed URL that a re-resolve may recover.
            if ((await readRefusalCode(response)) === 'coverage-required') {
                return failure(
                    'coverage-required',
                    'This release is part of a paid product. Connect your Library account and retry.',
                    true
                );
            }
            return failure('download-url-expired', 'The release download link is no longer valid.', true);
        }
        if (response.status === 404) {
            return failure('release-not-found', 'The registry no longer serves this artifact.', true);
        }
        // A server that answers 200 to a Range request ignored it. The staged
        // prefix is discarded and the full body is consumed in one attempt, so a
        // retry cannot loop forever re-sending the same Range request.
        const rangeIgnored = resumeFrom > 0 && response.status === 200;
        if (resumeFrom > 0 && response.status !== 206 && !rangeIgnored) {
            return failure('download-failed', 'The registry did not honour the resume request.', true);
        }
        if (rangeIgnored) {
            await fs.rm(input.stagingPath, { force: true }).catch(() => undefined);
        }
        if (!response.ok) {
            return failure('download-failed', `The registry answered ${response.status}.`, response.status >= 500);
        }
        if (!response.body) {
            return failure('download-failed', 'The registry returned no artifact body.', true);
        }

        // `Content-Length` is an early hint only; the streamed byte count below is
        // the enforcement, so a lying header cannot smuggle an oversized artifact.
        // The free-space budget is measured independently of the header and
        // includes the extraction and immutable-copy headroom the artifact will
        // need after it lands, not just its own size.
        const declared = Number(response.headers.get('content-length') ?? Number.NaN);
        const freeDiskBytes = await this.#freeDisk(input.stagingPath);
        const bounds = evaluateDownloadBounds({
            declaredBytes:
                Number.isFinite(declared) && declared > 0 && !rangeIgnored ? declared : 1,
            bounds: {
                maxBytes: this.#options.maxArtifactBytes,
                remainingDiskBytes: freeDiskBytes,
                reserveBytes: this.#options.reserveBytes,
            },
        });
        if (!bounds.ok) {
            await response.body.cancel();
            return refusalToFailure(bounds.refusal);
        }

        let written = rangeIgnored ? 0 : resumeFrom;
        // A resume cannot re-hash the already-staged prefix safely, so the digest
        // is always computed over the completed file before it is accepted.
        const handle = await fs.open(
            input.stagingPath,
            resumeFrom > 0 && !rangeIgnored ? 'a' : 'w',
            0o600
        );
        try {
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;
                written += value.byteLength;
                if (written > this.#options.maxArtifactBytes) {
                    await reader.cancel('artifact-too-large');
                    return failure(
                        'download-over-limit',
                        `The artifact exceeds the ${this.#options.maxArtifactBytes}-byte acquisition ceiling.`
                    );
                }
                // Extraction and the immutable copy each need room for the same
                // bytes, so the streamed total is budgeted at three times its own
                // size plus the instance reserve. This does not depend on any
                // header, so an undeclared or lying size cannot exhaust the disk.
                if (written * 3 + this.#options.reserveBytes > freeDiskBytes) {
                    await reader.cancel('storage-unavailable');
                    return failure(
                        'storage-unavailable',
                        'Staging this package would leave the instance without reserved free space.'
                    );
                }
                await handle.write(value);
            }
        } catch (error) {
            return failure(
                'download-failed',
                `The artifact download was interrupted after ${written} bytes.`,
                true
            );
        } finally {
            await handle.close();
        }

        // Verify the completed file against the signed archive digest.
        const digest = await sha256FileIdentity(input.stagingPath);
        const mismatch = evaluateArtifactDigest({
            expected: input.resolved.document.archiveSha256,
            actual: digest,
        });
        if (mismatch) return failure(mismatch.code as RegistryFailureCode, mismatch.message);

        return { ok: true, value: { bytes: written, digest, path: input.stagingPath } };
    }

    async #freeDisk(path: string): Promise<number> {
        if (this.#options.freeDiskBytes) return await this.#options.freeDiskBytes(path);
        const { statfs } = await import('node:fs/promises');
        const info = await statfs(dirname(resolve(path)));
        return Number(info.bavail) * Number(info.bsize);
    }
}

/**
 * The marketplace answers a metadata request with `{ releaseId, document }`.
 * The document is what is signed, so it is unwrapped here and the wrapper's
 * release id is checked by the expectation when the caller records one. A bare
 * document is accepted too, because the same policy must cover a plain document.
 */
function unwrapMetadataDocument(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'document' in value) {
        const wrapper = value as { document?: unknown };
        if (wrapper.document && typeof wrapper.document === 'object') return wrapper.document;
    }
    return value;
}

/** Parse the signed checkpoint plus its complete advisory/key snapshot. */
function parseCheckpointResponse(value: unknown): {
    readonly checkpoint: RegistryAdvisoryCheckpoint;
    readonly snapshot: RegistryAdvisorySnapshot;
} | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const checkpointValue = record.checkpoint;
    const snapshotValue = record.snapshot;
    if (
        !checkpointValue ||
        typeof checkpointValue !== 'object' ||
        Array.isArray(checkpointValue) ||
        !snapshotValue ||
        typeof snapshotValue !== 'object' ||
        Array.isArray(snapshotValue)
    ) {
        return null;
    }
    const checkpoint = checkpointValue as Record<string, unknown>;
    const snapshot = snapshotValue as Record<string, unknown>;
    if (
        checkpoint.schemaVersion !== 1 ||
        typeof checkpoint.registryOrigin !== 'string' ||
        typeof checkpoint.sequence !== 'number' ||
        !Number.isSafeInteger(checkpoint.sequence) ||
        checkpoint.sequence < 0 ||
        typeof checkpoint.issuedAt !== 'string' ||
        typeof checkpoint.expiresAt !== 'string' ||
        typeof checkpoint.snapshotSha256 !== 'string' ||
        !/^sha256-[a-f0-9]{64}$/.test(checkpoint.snapshotSha256) ||
        !checkpoint.signature ||
        typeof checkpoint.signature !== 'object' ||
        Array.isArray(checkpoint.signature)
    ) {
        return null;
    }
    const signature = checkpoint.signature as Record<string, unknown>;
    if (
        typeof signature.keyId !== 'string' ||
        signature.algorithm !== 'ed25519' ||
        typeof signature.value !== 'string' ||
        signature.value.length === 0
    ) {
        return null;
    }
    if (
        snapshot.schemaVersion !== 1 ||
        snapshot.sequence !== checkpoint.sequence ||
        !Array.isArray(snapshot.advisories) ||
        !Array.isArray(snapshot.keyStatuses)
    ) {
        return null;
    }
    const advisories: AdvisoryDocument[] = [];
    for (const raw of snapshot.advisories) {
        const parsed = parseAdvisoryDocument(raw);
        if (!parsed.document) return null;
        advisories.push(parsed.document);
    }
    const keyStatuses: RegistryAdvisorySnapshot['keyStatuses'][number][] = [];
    for (const raw of snapshot.keyStatuses) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const status = raw as Record<string, unknown>;
        if (
            typeof status.keyId !== 'string' ||
            status.keyId.length === 0 ||
            (status.status !== 'active' &&
                status.status !== 'retired' &&
                status.status !== 'compromised') ||
            typeof status.effectiveAt !== 'string' ||
            Number.isNaN(Date.parse(status.effectiveAt)) ||
            (status.reason !== undefined && typeof status.reason !== 'string')
        ) {
            return null;
        }
        keyStatuses.push({
            keyId: status.keyId,
            status: status.status,
            effectiveAt: status.effectiveAt,
            ...(typeof status.reason === 'string' ? { reason: status.reason } : {}),
        });
    }
    return {
        checkpoint: {
            schemaVersion: 1,
            registryOrigin: checkpoint.registryOrigin,
            sequence: checkpoint.sequence,
            issuedAt: checkpoint.issuedAt,
            expiresAt: checkpoint.expiresAt,
            snapshotSha256: checkpoint.snapshotSha256 as Sha256,
            signature: {
                keyId: signature.keyId,
                algorithm: 'ed25519',
                value: signature.value,
            },
        },
        snapshot: {
            schemaVersion: 1,
            sequence: snapshot.sequence,
            advisories,
            keyStatuses,
        },
    };
}

/** Digest identity of the exact canonical metadata bytes that were signed. */
export async function releaseMetadataDigest(document: ReleaseMetadataDocument): Promise<Sha256> {
    return await sha256Identity(encodeReleaseMetadata(document));
}

async function sha256HexOfFile(path: string): Promise<string> {
    const handle = await fs.open(path, 'r');
    try {
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(1024 * 1024);
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
            if (bytesRead === 0) break;
            hash.update(buffer.subarray(0, bytesRead));
        }
        return hash.digest('hex');
    } finally {
        await handle.close();
    }
}

/**
 * Digest identity of a staged artifact file. Used to decide whether an already
 * downloaded file still matches the signed archive digest, so an interrupted
 * operation reuses verified bytes instead of downloading them again.
 */
export async function sha256FileIdentity(path: string): Promise<Sha256> {
    return `sha256-${await sha256HexOfFile(path)}`;
}
