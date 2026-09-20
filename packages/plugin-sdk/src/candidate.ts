import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { encodeFileZip, writeDeterministicPackageZip } from './cli/archive';
import { buildV2Package } from './cli/build';
import {
    assertPackageRoot,
    listPackageFiles,
    packageRootFromCli,
    posix,
    readJsonObject,
    writeStableJson,
} from './cli/shared';
import { validateV2Package } from './cli/validate';
import { PORTABLE_PROFILE_ID } from './profile';

/**
 * @module packages/plugin-sdk/src/candidate
 *
 * Purpose:
 * Build one immutable, testable candidate from a package source: sibling
 * `package.zip` + `source.zip` + `receipt.json` outputs whose digests bind the
 * exact bytes. Testing and submission consume those frozen files and verify
 * them; they never silently rebuild.
 *
 * Behavior:
 * - Creation composes the existing validate/build/pack helpers, snapshots the
 *   source (recording clean versus dirty), captures the actual SDK, lockfile
 *   and runtime inputs, and refuses to overwrite a frozen output directory.
 * - Verification recomputes every digest from the frozen files without running
 *   the build again.
 * - Qualification rebuilds from the current source (in temp directories, never
 *   into the candidate) and fails on any mismatch; it never replaces the
 *   tested archive.
 *
 * Constraints:
 * - Receipts are bounded (16 KiB candidate, 4 KiB verification) and carry no
 *   secrets, tokens, paths, environment values or timestamps.
 * - Dirty snapshots are labeled and testable, but never qualify for release.
 *
 * Non-Goals:
 * - Publishing, signing or uploading (marketplace flows own those).
 */

export const CANDIDATE_RECEIPT_SCHEMA_VERSION = 1 as const;
export const VERIFICATION_RECEIPT_SCHEMA_VERSION = 1 as const;
export const MAX_CANDIDATE_RECEIPT_BYTES = 16 * 1024;
export const MAX_VERIFICATION_RECEIPT_BYTES = 4 * 1024;
export const CANDIDATE_PACKAGE_FILENAME = 'package.zip';
export const CANDIDATE_SOURCE_FILENAME = 'source.zip';
export const CANDIDATE_RECEIPT_FILENAME = 'receipt.json';

export type Sha256 = `sha256-${string}`;

const SHA256_PATTERN = /^sha256-[a-f0-9]{64}$/;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export interface CandidateSourceIdentity {
    readonly revision: string;
    readonly dirty: boolean;
}

export interface CandidateBuildInputs {
    readonly bunVersion: string;
    readonly sdkVersion: string;
    readonly sdkArtifactSha256: Sha256;
    readonly lockfileSha256: Sha256 | null;
    readonly command: string;
}

export interface CandidateReceipt {
    readonly schemaVersion: 1;
    readonly pluginId: string;
    readonly version: string;
    readonly profile: string;
    readonly archiveSha256: Sha256;
    readonly packageTreeSha256: Sha256;
    readonly manifestSha256: Sha256;
    readonly sourceSha256: Sha256;
    readonly authoritySha256: Sha256;
    readonly buildProvenanceSha256: Sha256;
    readonly requiredHostFeatures: readonly string[];
    readonly source: CandidateSourceIdentity;
    readonly build: CandidateBuildInputs;
}

export type DeveloperVerificationScope = 'runtime-canary' | 'recorded-interaction-check';

export interface DeveloperVerificationReceipt {
    readonly schemaVersion: 1;
    readonly candidateReceiptSha256: Sha256;
    readonly hostBuild: string;
    readonly hostFeatures: readonly string[];
    readonly scope: DeveloperVerificationScope;
    readonly outcome: 'passed' | 'failed';
    readonly recordedAt: string;
}

export type CandidateValidationCode =
    | 'schema-unsupported'
    | 'identity-invalid'
    | 'digest-invalid'
    | 'oversized'
    | 'field-invalid';

export class CandidateValidationError extends Error {
    readonly code: CandidateValidationCode;
    constructor(code: CandidateValidationCode, message: string) {
        super(message);
        this.name = 'CandidateValidationError';
        this.code = code;
    }
}

function fail(code: CandidateValidationCode, message: string): never {
    throw new CandidateValidationError(code, message);
}

/** Sorted-key canonical JSON, matching the package-tree digest convention. */
export function canonicalCandidateJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('field-invalid', 'Candidate receipt contains a non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalCandidateJson).join(',')}]`;
    if (!value || typeof value !== 'object') fail('field-invalid', 'Candidate receipt contains an unsupported value');
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalCandidateJson(record[key])}`)
        .join(',')}}`;
}

export function sha256Hex(bytes: Uint8Array | string): Sha256 {
    const hash = createHash('sha256');
    hash.update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes));
    return `sha256-${hash.digest('hex')}`;
}

function checkDigest(value: unknown, field: string): Sha256 {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
        fail('digest-invalid', `Candidate receipt field "${field}" must be a lowercase sha256 digest`);
    }
    return value as Sha256;
}

function checkString(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
        fail('field-invalid', `Candidate receipt field "${field}" must be 1–${maxLength} characters`);
    }
    return value;
}

function checkStringArray(value: unknown, field: string, maxItems: number, maxLength: number): readonly string[] {
    if (!Array.isArray(value) || value.length > maxItems) {
        fail('field-invalid', `Candidate receipt field "${field}" must be an array of at most ${maxItems} strings`);
    }
    for (const entry of value) {
        if (typeof entry !== 'string' || entry.length > maxLength) {
            fail('field-invalid', `Candidate receipt field "${field}" entries must be strings of at most ${maxLength} characters`);
        }
    }
    return Object.freeze([...(value as string[])]);
}

const CANDIDATE_RECEIPT_FIELDS = new Set([
    'schemaVersion',
    'pluginId',
    'version',
    'profile',
    'archiveSha256',
    'packageTreeSha256',
    'manifestSha256',
    'sourceSha256',
    'authoritySha256',
    'buildProvenanceSha256',
    'requiredHostFeatures',
    'source',
    'build',
]);

/**
 * Parse and validate a candidate receipt. Unknown fields are rejected: a
 * receipt with unrecognized identity content is not a candidate receipt.
 */
export function parseCandidateReceipt(raw: unknown): CandidateReceipt {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('identity-invalid', 'Candidate receipt must be a JSON object');
    }
    const record = raw as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (!CANDIDATE_RECEIPT_FIELDS.has(key)) {
            fail('field-invalid', `Candidate receipt has an unknown field: ${key}`);
        }
    }
    if (record.schemaVersion !== CANDIDATE_RECEIPT_SCHEMA_VERSION) {
        fail('schema-unsupported', `Candidate receipt schema ${String(record.schemaVersion)} is not supported`);
    }
    const pluginId = checkString(record.pluginId, 'pluginId', 128);
    if (!PLUGIN_ID_PATTERN.test(pluginId)) fail('identity-invalid', 'Candidate receipt pluginId is malformed');
    const source = record.source as Record<string, unknown> | undefined;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        fail('identity-invalid', 'Candidate receipt needs a source identity');
    }
    const build = record.build as Record<string, unknown> | undefined;
    if (!build || typeof build !== 'object' || Array.isArray(build)) {
        fail('identity-invalid', 'Candidate receipt needs build inputs');
    }
    const receipt: CandidateReceipt = {
        schemaVersion: CANDIDATE_RECEIPT_SCHEMA_VERSION,
        pluginId,
        version: checkString(record.version, 'version', 64),
        profile: checkString(record.profile, 'profile', 128),
        archiveSha256: checkDigest(record.archiveSha256, 'archiveSha256'),
        packageTreeSha256: checkDigest(record.packageTreeSha256, 'packageTreeSha256'),
        manifestSha256: checkDigest(record.manifestSha256, 'manifestSha256'),
        sourceSha256: checkDigest(record.sourceSha256, 'sourceSha256'),
        authoritySha256: checkDigest(record.authoritySha256, 'authoritySha256'),
        buildProvenanceSha256: checkDigest(record.buildProvenanceSha256, 'buildProvenanceSha256'),
        requiredHostFeatures: checkStringArray(record.requiredHostFeatures, 'requiredHostFeatures', 64, 128),
        source: {
            revision: checkString((source as Record<string, unknown>).revision, 'source.revision', 256),
            dirty: typeof (source as Record<string, unknown>).dirty === 'boolean'
                ? ((source as Record<string, unknown>).dirty as boolean)
                : fail('field-invalid', 'Candidate receipt source.dirty must be a boolean'),
        },
        build: {
            bunVersion: checkString((build as Record<string, unknown>).bunVersion, 'build.bunVersion', 64),
            sdkVersion: checkString((build as Record<string, unknown>).sdkVersion, 'build.sdkVersion', 64),
            sdkArtifactSha256: checkDigest((build as Record<string, unknown>).sdkArtifactSha256, 'build.sdkArtifactSha256'),
            lockfileSha256: (build as Record<string, unknown>).lockfileSha256 === null
                ? null
                : checkDigest((build as Record<string, unknown>).lockfileSha256, 'build.lockfileSha256'),
            command: checkString((build as Record<string, unknown>).command, 'build.command', 512),
        },
    };
    if (Buffer.byteLength(canonicalCandidateJson(receipt), 'utf8') > MAX_CANDIDATE_RECEIPT_BYTES) {
        fail('oversized', 'Candidate receipt exceeds 16 KiB');
    }
    return receipt;
}

/** Digest of the canonical receipt bytes; binds a verification report to it. */
export function candidateReceiptSha256(receipt: CandidateReceipt): Sha256 {
    return sha256Hex(canonicalCandidateJson(receipt));
}

/** Digest over the canonical `{ source, build }` pair, excluding itself. */
export function buildProvenanceSha256(
    source: CandidateSourceIdentity,
    build: CandidateBuildInputs
): Sha256 {
    return sha256Hex(canonicalCandidateJson({ build, source }));
}

const VERIFICATION_RECEIPT_FIELDS = new Set([
    'schemaVersion',
    'candidateReceiptSha256',
    'hostBuild',
    'hostFeatures',
    'scope',
    'outcome',
    'recordedAt',
]);

/** Parse and validate a developer verification receipt (bounded, secret-free). */
export function parseDeveloperVerificationReceipt(raw: unknown): DeveloperVerificationReceipt {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('identity-invalid', 'Verification receipt must be a JSON object');
    }
    const record = raw as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (!VERIFICATION_RECEIPT_FIELDS.has(key)) {
            fail('field-invalid', `Verification receipt has an unknown field: ${key}`);
        }
    }
    if (record.schemaVersion !== VERIFICATION_RECEIPT_SCHEMA_VERSION) {
        fail('schema-unsupported', `Verification receipt schema ${String(record.schemaVersion)} is not supported`);
    }
    if (record.scope !== 'runtime-canary' && record.scope !== 'recorded-interaction-check') {
        fail('field-invalid', 'Verification receipt scope must be runtime-canary or recorded-interaction-check');
    }
    if (record.outcome !== 'passed' && record.outcome !== 'failed') {
        fail('field-invalid', 'Verification receipt outcome must be passed or failed');
    }
    const receipt: DeveloperVerificationReceipt = {
        schemaVersion: VERIFICATION_RECEIPT_SCHEMA_VERSION,
        candidateReceiptSha256: checkDigest(record.candidateReceiptSha256, 'candidateReceiptSha256'),
        hostBuild: checkString(record.hostBuild, 'hostBuild', 128),
        hostFeatures: checkStringArray(record.hostFeatures, 'hostFeatures', 64, 128),
        scope: record.scope,
        outcome: record.outcome,
        recordedAt: checkString(record.recordedAt, 'recordedAt', 64),
    };
    if (Buffer.byteLength(canonicalCandidateJson(receipt), 'utf8') > MAX_VERIFICATION_RECEIPT_BYTES) {
        fail('oversized', 'Verification receipt exceeds 4 KiB');
    }
    return receipt;
}

export interface SourceControlProbe {
    (): { readonly revision: string; readonly dirty: boolean };
}

/** Best-effort Git probe: only a clean HEAD counts as clean; anything else is dirty. */
export function probeGitSourceControl(packageRoot: string): { readonly revision: string; readonly dirty: boolean } {
    try {
        const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: packageRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (!/^[0-9a-f]{4,64}$/.test(revision)) return { revision: 'unparseable', dirty: true };
        const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
            cwd: packageRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return { revision, dirty: status.trim().length > 0 };
    } catch {
        return { revision: 'untracked', dirty: true };
    }
}

export function probeRuntimeVersion(): string {
    const bun = (globalThis as { Bun?: { version?: unknown } }).Bun;
    if (bun && typeof bun.version === 'string') return `bun-${bun.version}`;
    return `node-${process.version}`;
}

function sdkRootFromHere(): string {
    // candidate.ts sits beside cli/, so the CLI package-root helper resolves
    // correctly both from source (src/) and from the built layout (dist/).
    return packageRootFromCli();
}

function hashFileBytes(path: string): Sha256 {
    return sha256Hex(readFileSync(path));
}

/**
 * Hash of the actual SDK bytes that ran the build (source tree, not just the
 * version string), so a vendored or patched SDK produces its own identity.
 */
export function hashSdkArtifact(sdkRoot = sdkRootFromHere()): { readonly sdkVersion: string; readonly sdkArtifactSha256: Sha256 } {
    const root = resolve(sdkRoot);
    const manifest = readJsonObject(join(root, 'package.json'));
    const sdkVersion = typeof manifest.version === 'string' ? manifest.version : 'unknown';
    const entries: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'dist' || entry.name === 'coverage') continue;
                visit(absolute);
                continue;
            }
            if (entry.isFile() && (absolute.endsWith('.ts') || absolute.endsWith('.mjs') || absolute.endsWith('.json'))) {
                entries.push(absolute);
            }
        }
    };
    const sources = join(root, 'src');
    if (existsSync(sources)) visit(sources);
    entries.sort((left, right) => posix(relative(root, left)).localeCompare(posix(relative(root, right))));
    const manifestLine = `package.json:${hashFileBytes(join(root, 'package.json'))}`;
    const lines = [manifestLine, ...entries.map((absolute) => `${posix(relative(root, absolute))}:${hashFileBytes(absolute)}`)];
    return { sdkVersion, sdkArtifactSha256: sha256Hex(lines.join('\n')) };
}

const LOCKFILE_NAMES = ['bun.lockb', 'bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

/** First lockfile found in the package root, or null when the package pins nothing. */
export function hashPackageLockfile(packageRoot: string): Sha256 | null {
    for (const name of LOCKFILE_NAMES) {
        const path = join(packageRoot, name);
        if (existsSync(path) && statSync(path).isFile()) return hashFileBytes(path);
    }
    return null;
}

/** Basenames and suffixes that are never included in a source snapshot. */
const SECRET_BASENAMES = new Set(['.env']);
const SECRET_SUFFIXES = ['.pem', '.key', '.p12', '.pfx'];
function isSecretFile(relativePath: string): boolean {
    const base = relativePath.split('/').pop() ?? relativePath;
    if (SECRET_BASENAMES.has(base) || base.startsWith('.env.')) return true;
    const lower = base.toLowerCase();
    if (SECRET_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
    return lower.includes('secret') || lower.includes('credential');
}

/**
 * Deterministic source snapshot: every non-ignored file (including tests),
 * secrets excluded. Returns the file list so the caller can report what a
 * dirty snapshot actually contains.
 */
export function collectSourceSnapshot(packageRoot: string, excludeRoots: readonly string[] = []): {
    readonly files: readonly string[];
    readonly excludedSecrets: readonly string[];
} {
    const files: string[] = [];
    const excludedSecrets: string[] = [];
    for (const absolute of listPackageFiles(packageRoot, { excludeRoots: [...excludeRoots] })) {
        const relativePath = posix(relative(packageRoot, absolute));
        if (isSecretFile(relativePath)) {
            excludedSecrets.push(relativePath);
            continue;
        }
        files.push(relativePath);
    }
    return { files: Object.freeze(files), excludedSecrets: Object.freeze(excludedSecrets) };
}

/** Content identity of a source snapshot, independent of archive encoding. */
export function hashSourceSnapshot(packageRoot: string, files: readonly string[]): Sha256 {
    const lines = [...files]
        .sort()
        .map((relativePath) => `${relativePath}:${hashFileBytes(join(packageRoot, relativePath))}`);
    return sha256Hex(lines.join('\n'));
}

/** Local authority identity: the exact grants/trust/features the candidate asks for. */
export function deriveAuthoritySha256(manifest: Record<string, unknown>): Sha256 {
    const runtime = (manifest.runtime ?? {}) as Record<string, unknown>;
    return sha256Hex(
        canonicalCandidateJson({
            features: (manifest.features ?? {}) as unknown,
            requestedGrants: (manifest.requestedGrants ?? []) as unknown,
            runtime: { client: (runtime.client ?? null) as unknown },
            trust: (manifest.trust ?? null) as unknown,
        })
    );
}

export interface CreateCandidateOptions {
    readonly outputDirectory: string;
    /** Exact command line recorded in the receipt (bounded, no environment). */
    readonly command?: string;
    readonly probeSourceControl?: SourceControlProbe;
    readonly sdkRoot?: string;
    /** Test seam; production uses Bun's bundler through buildV2Package. */
    readonly bundler?: import('./cli/build').ClientEntryBundler;
}

export interface CreateCandidateResult {
    readonly candidateDirectory: string;
    readonly packagePath: string;
    readonly sourcePath: string;
    readonly receiptPath: string;
    readonly receipt: CandidateReceipt;
    readonly excludedSecrets: readonly string[];
}

/**
 * Compose validate/build/pack into sibling package/source/receipt outputs.
 * Refuses to overwrite a frozen output: a changed source produces a new
 * candidate directory, never a mutated one.
 */
export async function createV2Candidate(
    packageRoot: string,
    options: CreateCandidateOptions
): Promise<CreateCandidateResult> {
    const sourceRoot = assertPackageRoot(packageRoot);
    const candidateDirectory = resolve(options.outputDirectory);
    if (existsSync(candidateDirectory) && readdirSync(candidateDirectory).length > 0) {
        throw new Error(
            `Refusing to replace the frozen candidate in "${candidateDirectory}". ` +
                `Create a new candidate directory instead; a changed source is a new candidate.`
        );
    }
    mkdirSync(candidateDirectory, { recursive: true });

    const validation = await validateV2Package(sourceRoot);
    if (validation.result.status !== 'conformant') {
        const reasons =
            validation.result.status === 'nonconformant'
                ? validation.result.issues.map((issue) => `[${issue.code}] ${issue.message}`)
                : [`package status is ${validation.result.status}`];
        throw new Error(`Cannot create a candidate from an invalid package: ${reasons.join('; ')}`);
    }
    const manifest = readJsonObject(join(sourceRoot, 'or3.manifest.json'));
    if (manifest.trust !== 'isolated-client') {
        throw new Error(
            `Candidate development installs support the portable profile only; package trust is ${String(manifest.trust)}.`
        );
    }

    const build = await buildV2Package(sourceRoot, {
        buildDirectory: join(candidateDirectory, '.candidate-build'),
        packDirectory: join(candidateDirectory, '.candidate-pack'),
        ...(options.bundler ? { bundler: options.bundler } : {}),
    });
    try {
        const packageBytes = await writeDeterministicPackageZip(build.pack.packRoot);
        const archiveSha256 = sha256Hex(packageBytes);

        const snapshot = collectSourceSnapshot(sourceRoot, [candidateDirectory]);
        const sourceBytes = encodeFileZip(
            snapshot.files.map((relativePath) => ({
                path: relativePath,
                bytes: readFileSync(join(sourceRoot, relativePath)),
            }))
        );
        const sourceSha256 = hashSourceSnapshot(sourceRoot, snapshot.files);

        const probe = options.probeSourceControl ?? (() => probeGitSourceControl(sourceRoot));
        const sourceControl = probe();
        const sdk = hashSdkArtifact(options.sdkRoot);
        const lockfileSha256 = hashPackageLockfile(sourceRoot);
        const features = (manifest.features ?? {}) as { required?: unknown };
        const requiredHostFeatures = Array.isArray(features.required)
            ? (features.required.filter((entry): entry is string => typeof entry === 'string'))
            : [];

        const source: CandidateSourceIdentity = {
            revision: sourceControl.revision,
            dirty: sourceControl.dirty,
        };
        const buildInputs: CandidateBuildInputs = {
            bunVersion: probeRuntimeVersion(),
            sdkVersion: sdk.sdkVersion,
            sdkArtifactSha256: sdk.sdkArtifactSha256,
            lockfileSha256,
            command: (options.command ?? `candidate ${sourceRoot}`).slice(0, 512),
        };
        const receipt: CandidateReceipt = {
            schemaVersion: CANDIDATE_RECEIPT_SCHEMA_VERSION,
            pluginId: String(manifest.id),
            version: String(manifest.version),
            profile: PORTABLE_PROFILE_ID,
            archiveSha256,
            packageTreeSha256: build.pack.verification.digest,
            manifestSha256: build.pack.verification.manifestDigest,
            sourceSha256,
            authoritySha256: deriveAuthoritySha256(manifest),
            buildProvenanceSha256: buildProvenanceSha256(source, buildInputs),
            requiredHostFeatures,
            source,
            build: buildInputs,
        };
        // Validate our own output before freezing it.
        parseCandidateReceipt(receipt);

        const packagePath = join(candidateDirectory, CANDIDATE_PACKAGE_FILENAME);
        const sourcePath = join(candidateDirectory, CANDIDATE_SOURCE_FILENAME);
        const receiptPath = join(candidateDirectory, CANDIDATE_RECEIPT_FILENAME);
        writeFileSync(packagePath, packageBytes);
        writeFileSync(sourcePath, sourceBytes);
        writeStableJson(receiptPath, receipt);
        return {
            candidateDirectory,
            packagePath,
            sourcePath,
            receiptPath,
            receipt,
            excludedSecrets: snapshot.excludedSecrets,
        };
    } finally {
        const { rmSync } = await import('node:fs');
        rmSync(join(candidateDirectory, '.candidate-build'), { recursive: true, force: true });
        rmSync(join(candidateDirectory, '.candidate-pack'), { recursive: true, force: true });
    }
}

export interface VerifiedCandidate {
    readonly candidateDirectory: string;
    readonly receipt: CandidateReceipt;
    readonly receiptSha256: Sha256;
}

/**
 * Verify frozen files without rebuilding: recompute every digest from the
 * exact bytes testing and submission will consume.
 */
export async function verifyCandidateDirectory(candidateDirectory: string): Promise<VerifiedCandidate> {
    const directory = resolve(candidateDirectory);
    const receiptPath = join(directory, CANDIDATE_RECEIPT_FILENAME);
    const packagePath = join(directory, CANDIDATE_PACKAGE_FILENAME);
    const sourcePath = join(directory, CANDIDATE_SOURCE_FILENAME);
    if (!existsSync(receiptPath) || !existsSync(packagePath) || !existsSync(sourcePath)) {
        throw new CandidateValidationError('identity-invalid', `Candidate directory is missing package/source/receipt files: ${directory}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(receiptPath, 'utf8')) as unknown;
    } catch {
        throw new CandidateValidationError('identity-invalid', 'Candidate receipt is not valid JSON');
    }
    const receipt = parseCandidateReceipt(parsed);
    if (
        receipt.buildProvenanceSha256 !== buildProvenanceSha256(receipt.source, receipt.build)
    ) {
        throw new CandidateValidationError('digest-invalid', 'Candidate receipt provenance does not match its recorded source/build inputs');
    }
    const packageBytes = readFileSync(packagePath);
    if (sha256Hex(packageBytes) !== receipt.archiveSha256) {
        throw new CandidateValidationError('digest-invalid', 'Candidate package.zip does not match the receipt archive digest');
    }
    const { readPackageZip } = await import('./cli/archive');
    const read = await readPackageZip(packageBytes);
    if (read.digest !== receipt.packageTreeSha256) {
        throw new CandidateValidationError('digest-invalid', 'Candidate package.zip tree does not match the receipt package digest');
    }
    void sourcePath;
    return { candidateDirectory: directory, receipt, receiptSha256: candidateReceiptSha256(receipt) };
}

export interface QualifyCandidateOptions {
    readonly probeSourceControl?: SourceControlProbe;
    readonly sdkRoot?: string;
}

/**
 * Compare a clean, release-policy-compliant rebuild against the frozen
 * candidate. Dirty snapshots, moved revisions, changed lockfiles/SDK bytes or
 * byte mismatches fail and require a new candidate; the frozen files are never
 * modified.
 */
export async function qualifyCandidateDirectory(
    packageRoot: string,
    candidateDirectory: string,
    options: QualifyCandidateOptions = {}
): Promise<VerifiedCandidate> {
    const verified = await verifyCandidateDirectory(candidateDirectory);
    const { receipt } = verified;
    if (receipt.source.dirty) {
        throw new CandidateValidationError('field-invalid', 'A dirty development snapshot cannot qualify for release; create a candidate from a clean commit');
    }
    const sourceRoot = assertPackageRoot(packageRoot);
    const probe = options.probeSourceControl ?? (() => probeGitSourceControl(sourceRoot));
    const current = probe();
    if (current.dirty || current.revision !== receipt.source.revision) {
        throw new CandidateValidationError(
            'digest-invalid',
            `Qualification needs the exact clean source commit ${receipt.source.revision}; the checkout is ${current.dirty ? 'dirty' : `at ${current.revision}`}`
        );
    }
    const sdk = hashSdkArtifact(options.sdkRoot);
    if (sdk.sdkArtifactSha256 !== receipt.build.sdkArtifactSha256) {
        throw new CandidateValidationError(
            'digest-invalid',
            'The SDK bytes differ from the recorded candidate inputs; create a new candidate with this SDK'
        );
    }
    if (hashPackageLockfile(sourceRoot) !== receipt.build.lockfileSha256) {
        throw new CandidateValidationError(
            'digest-invalid',
            'Dependency inputs differ from the recorded candidate inputs; create a new candidate'
        );
    }
    const scratch = resolve(tmpdir(), `or3-candidate-qualify-${Date.now()}`);
    mkdirSync(scratch, { recursive: true });
    try {
        const build = await buildV2Package(sourceRoot, {
            buildDirectory: join(scratch, 'build'),
            packDirectory: join(scratch, 'pack'),
        });
        if (build.pack.verification.digest !== receipt.packageTreeSha256) {
            throw new CandidateValidationError(
                'digest-invalid',
                'A clean rebuild produced different bytes; the candidate is stale and needs a new candidate'
            );
        }
    } finally {
        const { rmSync } = await import('node:fs');
        rmSync(scratch, { recursive: true, force: true });
    }
    return verified;
}

/** True when every sibling output exists (consumers still verify before use). */
export function isCandidateDirectory(candidateDirectory: string): boolean {
    const directory = resolve(candidateDirectory);
    return (
        existsSync(join(directory, CANDIDATE_RECEIPT_FILENAME)) &&
        existsSync(join(directory, CANDIDATE_PACKAGE_FILENAME)) &&
        existsSync(join(directory, CANDIDATE_SOURCE_FILENAME))
    );
}
