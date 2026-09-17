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
    encodeAdvisoryDocument,
    evaluateAdvisories,
    encodeReleaseMetadata,
    evaluateArtifactDigest,
    evaluateArtifactUrl,
    evaluateDownloadBounds,
    evaluateFreshness,
    evaluateReleaseMetadata,
    parseAdvisoryDocument,
    parseReleaseMetadata,
    type RegistryTrustRoot,
    type ReleaseMetadataDocument,
    type ReleaseMetadataExpectation,
    type ReleaseMetadataRefusal,
} from '~~/shared/plugins/acquisition/release-metadata';
import {
    verifyAdvisorySignature,
    verifyReleaseMetadataSignature,
} from './release-verify';

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
    readonly now?: () => number;
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
    | 'release-profile-unsupported'
    | 'release-expired'
    | 'release-engine-unsupported'
    | 'catalog-stale'
    | 'advisory-stale'
    | 'advisory-unverified'
    | 'release-quarantined'
    | 'download-url-invalid'
    | 'download-url-expired'
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

        // The signed advisory log decides whether this exact release is still
        // acquirable. It is fetched and verified here, not left to the caller:
        // freshness that is only checked "when supplied" is not checked at all.
        const advisories = await this.#verifyAdvisories(parsed.document);
        if (!advisories.ok) return advisories;

        const metadataSha256 = await releaseMetadataDigest(parsed.document);
        const artifact = this.#artifactReference(parsed.document.archiveSha256);
        if (!artifact.ok) return artifact;

        return {
            ok: true,
            value: {
                document: parsed.document,
                metadataSha256,
                artifactUrl: artifact.url,
                advisorySequence: advisories.value,
            },
        };
    }

    /**
     * Fetch the public signed advisory log, verify the advisories that apply to
     * this release, and refuse when one quarantines it. The newest sequence seen
     * is returned so the host can record it monotonically.
     */
    async #verifyAdvisories(
        document: ReleaseMetadataDocument
    ): Promise<RegistryResult<number>> {
        const fetched = await this.#getJson('/api/v1/catalog/trust/advisories');
        if (!fetched.ok) return fetched;
        const entries = advisoryListEntries(fetched.value);
        if (!entries) {
            return failure('advisory-unverified', 'The registry returned an unreadable advisory log.');
        }
        const accepted = this.#acceptedAdvisorySequence();
        const applicable = entries
            .filter((entry) => entry.sequence > accepted)
            .filter(
                (entry) =>
                    entry.releaseId === document.releaseId ||
                    (entry.pluginId === document.pluginId && entry.version === document.version)
            )
            .sort((left, right) => right.sequence - left.sequence);

        const parsedAdvisories = [];
        for (const entry of applicable) {
            const raw = await this.#getJson(
                `/api/v1/catalog/trust/advisories/${encodeURIComponent(String(entry.sequence))}`
            );
            if (!raw.ok) return raw;
            const unwrapped = unwrapAdvisoryDocument(raw.value);
            const parsed = parseAdvisoryDocument(unwrapped);
            if (!parsed.document) {
                return failure(
                    'advisory-unverified',
                    `Advisory ${entry.sequence} is unreadable: ${parsed.problems.join('; ')}`
                );
            }
            const signatureValid = await verifyAdvisorySignature({
                document: parsed.document,
                trustRoot: this.#options.trustRoot.releaseKeys,
            });
            if (
                !signatureValid ||
                !this.#options.trustRoot.releaseKeys.some(
                    (key) => key.keyId === parsed.document?.signature?.keyId
                )
            ) {
                return failure(
                    'advisory-unverified',
                    `Advisory ${entry.sequence} is not signed by a trusted release key.`
                );
            }
            parsedAdvisories.push(parsed.document);
        }

        const decision = evaluateAdvisories({
            advisories: parsedAdvisories,
            hostAcceptedAdvisorySequence: accepted,
            releaseId: document.releaseId,
            pluginId: document.pluginId,
            version: document.version,
        });
        const latest = Math.max(
            decision.latestSequence,
            entries.reduce((highest, entry) => Math.max(highest, entry.sequence), accepted)
        );
        if (decision.refusal) return refusalToFailure(decision.refusal);
        return { ok: true, value: latest };
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
    }): Promise<
        RegistryResult<{ readonly bytes: number; readonly digest: Sha256; readonly path: string }>
    > {
        const resumeFrom = input.resumeFromBytes ?? 0;

        await fs.mkdir(dirname(input.stagingPath), { recursive: true, mode: 0o700 });

        let response: Response;
        try {
            response = await this.#fetch(input.resolved.artifactUrl, {
                headers:
                    resumeFrom > 0
                        ? { range: `bytes=${resumeFrom}-`, accept: 'application/octet-stream' }
                        : { accept: 'application/octet-stream' },
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
            // Signed URLs expire; the caller re-resolves and tries again.
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

function unwrapAdvisoryDocument(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'document' in value) {
        const wrapper = value as { document?: unknown };
        if (wrapper.document && typeof wrapper.document === 'object') return wrapper.document;
    }
    return value;
}

interface AdvisoryListEntry {
    readonly sequence: number;
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
}

/** Shape of the marketplace's public advisory log (newest first). */
function advisoryListEntries(value: unknown): AdvisoryListEntry[] | null {
    if (!value || typeof value !== 'object') return null;
    const advisories = (value as { advisories?: unknown }).advisories;
    if (!Array.isArray(advisories)) return null;
    const entries: AdvisoryListEntry[] = [];
    for (const entry of advisories) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const sequence = record.sequence;
        if (
            typeof sequence !== 'number' ||
            !Number.isSafeInteger(sequence) ||
            sequence <= 0 ||
            typeof record.releaseId !== 'string' ||
            typeof record.pluginId !== 'string' ||
            typeof record.version !== 'string'
        ) {
            continue;
        }
        entries.push({
            sequence,
            releaseId: record.releaseId,
            pluginId: record.pluginId,
            version: record.version,
        });
    }
    return entries;
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
