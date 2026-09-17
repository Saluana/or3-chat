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
    encodeReleaseMetadata,
    evaluateArtifactDigest,
    evaluateArtifactUrl,
    evaluateDownloadBounds,
    evaluateFreshness,
    evaluateReleaseMetadata,
    parseReleaseMetadata,
    type RegistryTrustRoot,
    type ReleaseMetadataDocument,
    type ReleaseMetadataExpectation,
    type ReleaseMetadataRefusal,
} from '~~/shared/plugins/acquisition/release-metadata';
import { verifyReleaseMetadataSignature } from './release-verify';

export interface RegistryClientOptions {
    readonly registryOrigin: string;
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

        const path =
            input.expectation.releaseId !== undefined
                ? `/v1/releases/${encodeURIComponent(input.expectation.releaseId)}/metadata`
                : `/v1/plugins/${encodeURIComponent(input.expectation.pluginId)}/versions/${encodeURIComponent(
                      input.expectation.version ?? 'latest'
                  )}/metadata`;

        const fetched = await this.#getJson(path);
        if (!fetched.ok) return fetched;

        const parsed = parseReleaseMetadata(fetched.value);
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
            trustRoot: { ...this.#options.trustRoot, registryOrigin: this.#options.registryOrigin },
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

        const metadataSha256 = await releaseMetadataDigest(parsed.document);
        const artifact = this.#artifactReference(parsed.document.archiveSha256);
        if (!artifact.ok) return artifact;

        return {
            ok: true,
            value: {
                document: parsed.document,
                metadataSha256,
                artifactUrl: artifact.url,
                advisorySequence: input.latestAdvisorySequence ?? 0,
            },
        };
    }

    /**
     * The artifact is content-addressed by the signed archive digest, so its URL
     * is derived here rather than taken from anything the caller or the document
     * says. Only same-origin HTTPS is accepted.
     */
    #artifactReference(digest: Sha256): { ok: true; url: string } | { ok: false; failure: RegistryFailure } {
        const url = joinOrigin(this.#options.registryOrigin, `/v1/artifacts/${digest}/package.or3pkg`);
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
        if (resumeFrom > 0 && response.status !== 206) {
            // The registry ignored the range; start over rather than corrupting.
            return failure('download-failed', 'The registry did not honour the resume request.', true);
        }
        if (!response.ok) {
            return failure('download-failed', `The registry answered ${response.status}.`, response.status >= 500);
        }
        if (!response.body) {
            return failure('download-failed', 'The registry returned no artifact body.', true);
        }

        // `Content-Length` is an early hint only; the streamed byte count below is
        // the enforcement, so a lying header cannot smuggle an oversized artifact.
        const declared = Number(response.headers.get('content-length') ?? Number.NaN);
        const bounds = evaluateDownloadBounds({
            declaredBytes: Number.isFinite(declared) && declared > 0 ? declared : 1,
            bounds: {
                maxBytes: this.#options.maxArtifactBytes,
                remainingDiskBytes: await this.#freeDisk(input.stagingPath),
                reserveBytes: this.#options.reserveBytes,
            },
        });
        if (!bounds.ok) {
            await response.body.cancel();
            return refusalToFailure(bounds.refusal);
        }

        let written = resumeFrom;
        // A resume cannot re-hash the already-staged prefix safely, so the digest
        // is always computed over the completed file before it is accepted.
        const handle = await fs.open(
            input.stagingPath,
            resumeFrom > 0 ? 'a' : 'w',
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
