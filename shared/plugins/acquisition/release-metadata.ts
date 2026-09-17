/**
 * @module shared/plugins/acquisition/release-metadata
 *
 * Purpose:
 * The pinned shape of a signed release metadata document, how its exact bytes are
 * encoded, and the policy decisions a host makes about it before anything is
 * downloaded or activated.
 *
 * Behavior:
 * - The canonical encoding is the same rule the marketplace signs with (sorted
 *   keys, no whitespace, `undefined` removed), so a signature over the document
 *   verifies byte-for-byte. A frozen fixture pins that rule.
 * - A document is accepted only when it is schema-valid, signed by a key in the
 *   host's trust root, and consistent with what was requested.
 * - Freshness is monotonic: an advisory sequence lower than the highest already
 *   accepted is refused, so a replayed catalog cannot clear a revocation. A
 *   release's own publication date is *not* freshness: an immutable release does
 *   not become unsafe because it is old, so a quarantine decision is carried by
 *   the signed advisory log instead of an age limit.
 * - Profile, engines and digests are checked here, before any byte is fetched.
 *
 * Constraints:
 * - Pure: no I/O, no timers, no network. The signature itself is verified by the
 *   server-side caller, which passes the verification result in.
 *
 * Non-Goals:
 * - Fetching metadata or artifacts (the registry client owns that).
 */

import type { Sha256 } from '../runtime-descriptor';

/** Pinned schema of the signed release metadata this host accepts. */
export interface ReleaseMetadataDocument {
    readonly schemaVersion: 1;
    readonly releaseId: string;
    readonly pluginId: string;
    readonly publisherNamespace: string;
    readonly version: string;
    readonly archiveSha256: Sha256;
    readonly packageTreeSha256: Sha256;
    readonly manifestSha256: Sha256;
    readonly authoritySha256: Sha256;
    readonly sourceSha256: Sha256;
    readonly profile: string;
    readonly engines: { readonly or3: string; readonly pluginApi: string };
    readonly features: readonly string[];
    readonly requestedGrants: readonly string[];
    readonly reviewId: string;
    readonly license: string;
    readonly publishedAt: string;
    /** Present when the registry signs the document; required by this host. */
    readonly signature?: {
        readonly keyId: string;
        readonly algorithm: 'ed25519';
        readonly value: string;
    };
}

export interface RegistryTrustRoot {
    readonly registryOrigin: string;
    /** Release keys this host trusts, by key id. Empty means nothing is trusted. */
    readonly releaseKeys: readonly {
        readonly keyId: string;
        readonly publicJwk: { readonly kty: string; readonly crv: string; readonly x: string };
    }[];
    /**
     * Profiles this host can actually run. Derived from the host's declared
     * package capabilities, so a signed profile the host cannot execute is
     * refused here rather than being handed to a loader that cannot honour it.
     */
    readonly supportedProfiles: readonly string[];
    /** The host's own OR3 engine version, used for the engine range check. */
    readonly hostOr3Version: string;
    readonly hostPluginApiVersion: string;
    /** Highest advisory sequence this host has already accepted. */
    readonly acceptedAdvisorySequence: number;
}

export type ReleaseMetadataRefusalCode =
    | 'release-metadata-invalid'
    | 'release-metadata-unsigned'
    | 'release-key-untrusted'
    | 'release-identity-mismatch'
    | 'release-digest-mismatch'
    | 'release-profile-unsupported'
    | 'release-engine-unsupported'
    | 'advisory-stale'
    | 'advisory-unverified'
    | 'release-quarantined'
    | 'catalog-stale'
    | 'download-over-limit'
    | 'download-url-invalid'
    | 'download-url-expired'
    | 'archive-digest-mismatch'
    | 'storage-unavailable';

export interface ReleaseMetadataRefusal {
    readonly code: ReleaseMetadataRefusalCode;
    readonly message: string;
}

export type ReleaseMetadataDecision =
    | { readonly ok: true; readonly document: ReleaseMetadataDocument }
    | { readonly ok: false; readonly refusal: ReleaseMetadataRefusal };

const SHA256_PATTERN = /^sha256-[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function refusal(code: ReleaseMetadataRefusalCode, message: string): ReleaseMetadataDecision {
    return { ok: false, refusal: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is Sha256 {
    return typeof value === 'string' && SHA256_PATTERN.test(value);
}

/**
 * Canonical JSON: sorted keys, `undefined` dropped, no whitespace. This must stay
 * byte-identical to the marketplace's signing encoder.
 */
export function canonicalizeReleaseMetadata(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalizeReleaseMetadata);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, entry]) => entry !== undefined)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([key, entry]) => [key, canonicalizeReleaseMetadata(entry)])
        );
    }
    return value;
}

export function encodeReleaseMetadata(document: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(canonicalizeReleaseMetadata(document)));
}

export async function releaseMetadataSha256(document: unknown): Promise<Sha256> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        encodeReleaseMetadata(document) as unknown as BufferSource
    );
    return `sha256-${[...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')}`;
}

export interface ParseReleaseMetadataResult {
    readonly document: ReleaseMetadataDocument | null;
    readonly problems: readonly string[];
}

/** Validate the document's shape only; signature and policy are separate steps. */
export function parseReleaseMetadata(input: unknown): ParseReleaseMetadataResult {
    const problems: string[] = [];
    if (!isRecord(input)) return { document: null, problems: ['metadata must be an object'] };

    const at = (field: string, message: string) => problems.push(`${field}: ${message}`);
    if (input.schemaVersion !== 1) at('schemaVersion', 'must be 1');
    for (const field of ['releaseId', 'pluginId', 'publisherNamespace', 'profile', 'reviewId', 'license'] as const) {
        if (typeof input[field] !== 'string' || String(input[field]).length === 0) {
            at(field, 'must be a non-empty string');
        }
    }
    if (typeof input.version !== 'string' || !SEMVER_PATTERN.test(input.version)) {
        at('version', 'must be a semantic version');
    }
    for (const field of [
        'archiveSha256',
        'packageTreeSha256',
        'manifestSha256',
        'authoritySha256',
        'sourceSha256',
    ] as const) {
        if (!isSha256(input[field])) at(field, 'must be a sha256- digest');
    }
    if (typeof input.publishedAt !== 'string' || Number.isNaN(Date.parse(input.publishedAt))) {
        at('publishedAt', 'must be an ISO timestamp');
    }
    if (!isRecord(input.engines)) at('engines', 'must be an object');
    else {
        if (typeof input.engines.or3 !== 'string') at('engines.or3', 'must be a string');
        if (typeof input.engines.pluginApi !== 'string') at('engines.pluginApi', 'must be a string');
    }
    for (const field of ['features', 'requestedGrants'] as const) {
        if (!Array.isArray(input[field]) || input[field].some((entry) => typeof entry !== 'string')) {
            at(field, 'must be an array of strings');
        }
    }
    if (input.signature !== undefined) {
        if (!isRecord(input.signature)) at('signature', 'must be an object');
        else {
            if (typeof input.signature.keyId !== 'string') at('signature.keyId', 'must be a string');
            if (input.signature.algorithm !== 'ed25519') at('signature.algorithm', 'must be ed25519');
            if (typeof input.signature.value !== 'string' || input.signature.value.length === 0) {
                at('signature.value', 'must be base64');
            }
        }
    }

    // A plugin id must be usable as a single path segment and never escape it.
    if (typeof input.pluginId === 'string' && (!ID_PATTERN.test(input.pluginId) || input.pluginId.includes('..'))) {
        at('pluginId', 'must be a lowercase id without path separators');
    }

    if (problems.length > 0) return { document: null, problems };
    return { document: input as unknown as ReleaseMetadataDocument, problems: [] };
}

export interface ReleaseMetadataExpectation {
    readonly pluginId: string;
    /** Preferred version; when absent the document's own version is accepted. */
    readonly version?: string;
    /** Release id the caller resolved, when it already knows one. */
    readonly releaseId?: string;
}

/** Simple major.minor.patch comparison sufficient for the pinned engine ranges. */
export function compareVersions(left: string, right: string): number {
    const parse = (value: string): number[] => {
        const core = value.replace(/^[^\d]*/, '').split('-')[0] ?? '';
        return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    };
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0);
        if (difference !== 0) return difference < 0 ? -1 : 1;
    }
    return 0;
}

/**
 * What a signed profile requires the package to actually be. A profile is not a
 * label: a document that claims the portable client profile must describe a
 * package that really is an isolated browser-only package, and the host must be
 * able to run that shape before the profile is accepted at all.
 */
export interface AcquisitionProfileRequirement {
    readonly profile: string;
    /** Trust mode the signed profile requires `manifest.trust` to declare. */
    readonly trust: string;
    readonly clientRuntime: 'required' | 'forbidden';
    readonly serverRuntime: 'allowed' | 'forbidden';
    /** Client isolation modes the profile allows, when it needs a client runtime. */
    readonly clientIsolation?: readonly string[];
}

export const ACQUISITION_PROFILE_REQUIREMENTS: readonly AcquisitionProfileRequirement[] =
    Object.freeze([
        Object.freeze({
            profile: 'or3-portable-client-v1',
            trust: 'isolated-client',
            clientRuntime: 'required' as const,
            serverRuntime: 'forbidden' as const,
            clientIsolation: Object.freeze(['worker', 'iframe'] as const),
        }),
    ]);

export function acquisitionProfileRequirement(
    profile: string
): AcquisitionProfileRequirement | null {
    return ACQUISITION_PROFILE_REQUIREMENTS.find((entry) => entry.profile === profile) ?? null;
}

/**
 * The profiles this host may acquire, given the package trust modes it declares.
 * A profile whose required trust mode is not declared is not supported: there is
 * no "try it and see" path, because the loader that would run it is not there.
 */
export function supportedAcquisitionProfiles(
    supportedTrustModes: readonly string[]
): readonly string[] {
    const declared = new Set(supportedTrustModes);
    return ACQUISITION_PROFILE_REQUIREMENTS.filter((entry) => declared.has(entry.trust)).map(
        (entry) => entry.profile
    );
}

export function evaluateReleaseMetadata(input: {
    readonly document: ReleaseMetadataDocument;
    readonly trustRoot: RegistryTrustRoot;
    readonly expectation: ReleaseMetadataExpectation;
    /** Result of verifying the document's signature with `signature.keyId`. */
    readonly signatureValid: boolean;
    /** Wall clock, injected so the policy is testable. */
    readonly now: number;
}): ReleaseMetadataDecision {
    const { document, trustRoot, expectation } = input;

    if (!document.signature) {
        return refusal('release-metadata-unsigned', 'Release metadata carries no signature.');
    }
    const trusted = trustRoot.releaseKeys.some((key) => key.keyId === document.signature?.keyId);
    if (!trusted) {
        return refusal(
            'release-key-untrusted',
            `Release metadata is signed by untrusted key ${document.signature.keyId}.`
        );
    }
    if (!input.signatureValid) {
        return refusal(
            'release-key-untrusted',
            `The signature for ${document.signature.keyId} does not verify.`
        );
    }

    if (document.pluginId !== expectation.pluginId) {
        return refusal(
            'release-identity-mismatch',
            `Metadata describes ${document.pluginId}, not ${expectation.pluginId}.`
        );
    }
    if (expectation.version !== undefined && document.version !== expectation.version) {
        return refusal(
            'release-identity-mismatch',
            `Metadata describes version ${document.version}, not ${expectation.version}.`
        );
    }
    if (expectation.releaseId !== undefined && document.releaseId !== expectation.releaseId) {
        return refusal(
            'release-identity-mismatch',
            `Metadata describes release ${document.releaseId}, not ${expectation.releaseId}.`
        );
    }

    if (!trustRoot.supportedProfiles.includes(document.profile)) {
        const requirement = acquisitionProfileRequirement(document.profile);
        return refusal(
            'release-profile-unsupported',
            requirement
                ? `Profile ${document.profile} requires trust mode ${requirement.trust}, which this host does not support.`
                : `This host does not support profile ${document.profile}.`
        );
    }

    if (
        document.engines.or3.length > 0 &&
        compareVersions(trustRoot.hostOr3Version, document.engines.or3.replace(/^[>=^~\s]+/, '')) < 0
    ) {
        return refusal(
            'release-engine-unsupported',
            `The release requires or3 ${document.engines.or3}; this host runs ${trustRoot.hostOr3Version}.`
        );
    }
    if (
        document.engines.pluginApi.length > 0 &&
        compareVersions(
            trustRoot.hostPluginApiVersion,
            document.engines.pluginApi.replace(/^[>=^~\s]+/, '')
        ) < 0
    ) {
        return refusal(
            'release-engine-unsupported',
            `The release requires plugin API ${document.engines.pluginApi}; this host provides ${trustRoot.hostPluginApiVersion}.`
        );
    }

    return { ok: true, document };
}

/**
 * Freshness: catalog and advisory sequences must never move backwards. A replayed
 * catalog must not be able to clear a revocation the host already accepted.
 */
export function evaluateFreshness(input: {
    readonly hostAcceptedAdvisorySequence: number;
    readonly catalogAdvisorySequence: number;
    readonly latestAdvisorySequence: number;
}): ReleaseMetadataRefusal | null {
    if (input.latestAdvisorySequence < input.hostAcceptedAdvisorySequence) {
        return {
            code: 'advisory-stale',
            message: `Advisory sequence ${input.latestAdvisorySequence} is lower than the accepted sequence ${input.hostAcceptedAdvisorySequence}.`,
        };
    }
    if (input.catalogAdvisorySequence < input.hostAcceptedAdvisorySequence) {
        return {
            code: 'advisory-stale',
            message: `Catalog was built at advisory sequence ${input.catalogAdvisorySequence}, below the accepted sequence ${input.hostAcceptedAdvisorySequence}.`,
        };
    }
    return null;
}

export interface DownloadBounds {
    readonly maxBytes: number;
    readonly remainingDiskBytes: number;
    /** Free-space headroom kept for the running instance. */
    readonly reserveBytes: number;
}

export type DownloadBoundsDecision =
    | { readonly ok: true }
    | { readonly ok: false; readonly refusal: ReleaseMetadataRefusal };

/**
 * Refuse a download that cannot fit: an artifact larger than the per-acquisition
 * ceiling, or one that would consume the instance's reserved headroom.
 */
export function evaluateDownloadBounds(input: {
    readonly declaredBytes: number;
    readonly bounds: DownloadBounds;
}): DownloadBoundsDecision {
    if (!Number.isFinite(input.declaredBytes) || input.declaredBytes <= 0) {
        return {
            ok: false,
            refusal: { code: 'release-metadata-invalid', message: 'Archive size is unknown.' },
        };
    }
    if (input.declaredBytes > input.bounds.maxBytes) {
        return {
            ok: false,
            refusal: {
                code: 'download-over-limit',
                message: `The archive is ${input.declaredBytes} bytes, above the ${input.bounds.maxBytes}-byte acquisition ceiling.`,
            },
        };
    }
    if (input.declaredBytes + input.bounds.reserveBytes > input.bounds.remainingDiskBytes) {
        return {
            ok: false,
            refusal: {
                code: 'storage-unavailable',
                message: 'There is not enough free storage to stage this package safely.',
            },
        };
    }
    return { ok: true };
}

/**
 * The artifact's own digest must equal the signed metadata's archive digest.
 * A transport digest that disagrees is refused before tree verification.
 */
export function evaluateArtifactDigest(input: {
    readonly expected: Sha256;
    readonly actual: Sha256;
}): ReleaseMetadataRefusal | null {
    if (input.expected !== input.actual) {
        return {
            code: 'archive-digest-mismatch',
            message: 'The downloaded archive does not match the signed release digest.',
        };
    }
    return null;
}

/**
 * A registry artifact URL must be same-origin HTTPS on the configured registry,
 * never an arbitrary URL the caller supplied.
 */
export function evaluateArtifactUrl(input: {
    readonly url: string;
    readonly registryOrigin: string;
}): ReleaseMetadataRefusal | null {
    let parsed: URL;
    try {
        parsed = new URL(input.url);
    } catch {
        return { code: 'download-url-invalid', message: 'The artifact URL is not a valid URL.' };
    }
    if (parsed.protocol !== 'https:') {
        return { code: 'download-url-invalid', message: 'Artifact downloads must use HTTPS.' };
    }
    const expected = new URL(input.registryOrigin);
    if (parsed.origin !== expected.origin) {
        return {
            code: 'download-url-invalid',
            message: `Artifact downloads must come from ${expected.origin}, not ${parsed.origin}.`,
        };
    }
    return null;
}

/** The pinned shape of a signed advisory document (the marketplace's advisory log). */
export interface AdvisoryDocument {
    readonly schemaVersion: 1;
    readonly sequence: number;
    readonly kind: 'quarantine' | 'repair-available' | 'notice';
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    readonly archiveSha256: string | null;
    readonly reason: string;
    readonly issuedBy: string;
    readonly issuedAt: string;
    readonly signature?: {
        readonly keyId: string;
        readonly algorithm: 'ed25519';
        readonly value: string;
    };
}

export interface ParseAdvisoryResult {
    readonly document: AdvisoryDocument | null;
    readonly problems: readonly string[];
}

export function parseAdvisoryDocument(input: unknown): ParseAdvisoryResult {
    if (!isRecord(input)) return { document: null, problems: ['advisory must be an object'] };
    const problems: string[] = [];
    const at = (field: string, message: string) => problems.push(`${field}: ${message}`);
    if (input.schemaVersion !== 1) at('schemaVersion', 'must be 1');
    if (typeof input.sequence !== 'number' || !Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
        at('sequence', 'must be a positive integer');
    }
    if (input.kind !== 'quarantine' && input.kind !== 'repair-available' && input.kind !== 'notice') {
        at('kind', 'must be quarantine, repair-available or notice');
    }
    for (const field of ['releaseId', 'pluginId', 'version', 'reason', 'issuedBy'] as const) {
        if (typeof input[field] !== 'string' || String(input[field]).length === 0) {
            at(field, 'must be a non-empty string');
        }
    }
    if (typeof input.issuedAt !== 'string' || Number.isNaN(Date.parse(input.issuedAt))) {
        at('issuedAt', 'must be an ISO timestamp');
    }
    if (input.archiveSha256 !== null && !isSha256(input.archiveSha256)) {
        at('archiveSha256', 'must be null or a sha256- digest');
    }
    if (input.signature !== undefined) {
        if (!isRecord(input.signature)) at('signature', 'must be an object');
        else {
            if (typeof input.signature.keyId !== 'string') at('signature.keyId', 'must be a string');
            if (input.signature.algorithm !== 'ed25519') at('signature.algorithm', 'must be ed25519');
            if (typeof input.signature.value !== 'string' || input.signature.value.length === 0) {
                at('signature.value', 'must be base64');
            }
        }
    }
    if (problems.length > 0) return { document: null, problems };
    return { document: input as unknown as AdvisoryDocument, problems: [] };
}

/** Canonical bytes a signed advisory covers: the document without its signature. */
export function encodeAdvisoryDocument(document: AdvisoryDocument): Uint8Array {
    const { signature: _signature, ...unsigned } = document;
    return encodeReleaseMetadata(unsigned);
}

export interface AdvisoryDecision {
    readonly latestSequence: number;
    /** Newest sequence that applies to this release and was accepted. */
    readonly refusal: ReleaseMetadataRefusal | null;
}

/**
 * A quarantine decision scoped to one release, independent of the cursor. The
 * host stamps `recordedAt` when it persists the decision.
 */
export interface ScopedQuarantine {
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    readonly sequence: number;
    readonly reason: string;
}

/**
 * Find the newest verified quarantine that applies to one release, considering
 * *every* provided advisory rather than only those above the host's advisory
 * cursor.
 *
 * The cursor answers "how fresh is this host's view of the log", not "which
 * scoped decisions still apply". Using it to filter scoped advisories lets an
 * unrelated release's advisory advance the cursor past a quarantine and so clear
 * it. Quarantine decisions are therefore evaluated here and persisted per
 * release, separately from the cursor.
 */
export function findApplicableQuarantine(input: {
    readonly advisories: readonly AdvisoryDocument[];
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
}): ScopedQuarantine | null {
    const applicable = input.advisories
        .filter(
            (advisory) =>
                advisory.releaseId === input.releaseId ||
                (advisory.pluginId === input.pluginId && advisory.version === input.version)
        )
        .sort((left, right) => right.sequence - left.sequence);
    const quarantine = applicable.find((advisory) => advisory.kind === 'quarantine');
    if (!quarantine) return null;
    return {
        releaseId: quarantine.releaseId,
        pluginId: quarantine.pluginId,
        version: quarantine.version,
        sequence: quarantine.sequence,
        reason: quarantine.reason,
    };
}

/** Refusal for a quarantine this host has already recorded for the release. */
export function recordedQuarantineRefusal(quarantine: {
    readonly pluginId: string;
    readonly version: string;
    readonly reason: string;
}): ReleaseMetadataRefusal {
    return {
        code: 'release-quarantined',
        message: `${quarantine.pluginId} ${quarantine.version} is quarantined: ${quarantine.reason}`,
    };
}

/**
 * Apply the signed advisory log to one release. A quarantine that this host has
 * not yet accepted refuses the acquisition; the newest seen sequence is returned
 * so the host can record it monotonically. Advisories for other releases only
 * advance the sequence, and an already-accepted (or older) advisory is history.
 */
export function evaluateAdvisories(input: {
    readonly advisories: readonly AdvisoryDocument[];
    readonly hostAcceptedAdvisorySequence: number;
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
}): AdvisoryDecision {
    let latestSequence = input.hostAcceptedAdvisorySequence;
    for (const advisory of input.advisories) {
        if (advisory.sequence > latestSequence) latestSequence = advisory.sequence;
    }
    const applicable = input.advisories
        .filter((advisory) => advisory.sequence > input.hostAcceptedAdvisorySequence)
        .filter(
            (advisory) =>
                advisory.releaseId === input.releaseId ||
                (advisory.pluginId === input.pluginId && advisory.version === input.version)
        )
        .sort((left, right) => right.sequence - left.sequence);
    const quarantine = applicable.find((advisory) => advisory.kind === 'quarantine');
    if (quarantine) {
        return {
            latestSequence,
            refusal: {
                code: 'release-quarantined',
                message: `${quarantine.pluginId} ${quarantine.version} was quarantined at advisory sequence ${quarantine.sequence}: ${quarantine.reason}`,
            },
        };
    }
    return { latestSequence, refusal: null };
}
