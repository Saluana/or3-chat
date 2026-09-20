import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildProvenanceSha256, hashSnapshotEntries } from '@or3/plugin-sdk/candidate';
import { encodeFileZip } from '@or3/plugin-sdk/package-archive';

/**
 * The admission boundary fails closed: an ineligible host, a malformed
 * receipt, or bytes that do not match the receipt are refused before any
 * candidate state changes. The ordinary raw-upload policy is untouched.
 */
const eligibilityMock = vi.fn();
const rateLimitMock = vi.fn(async () => true);
const recordMock = vi.fn(async () => undefined);
const prepareMock = vi.fn(async (): Promise<Record<string, unknown>> => ({
    status: 'blocked',
    pointerUnchanged: true,
    stage: 'grants',
    codes: ['grant-review-required'],
}));
const readPackageZipMock = vi.fn<() => Promise<{ digest: string; entries: number; extractedRoot: null }>>(async () => {
    throw new Error('not a package archive');
});

let multipartParts: { name?: string; data: unknown }[] | null = null;

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(options.statusMessage ?? 'error'), options),
    readMultipartFormData: async () => multipartParts,
}));

vi.mock('../../../../../admin/api', () => ({
    requireAdminApiContext: async () => ({
        principal: { kind: 'super_admin', username: 'admin' },
    }),
}));

vi.mock('../../../../../admin/workspace-target', () => ({
    resolveAdminWorkspaceTarget: () => 'ws-1',
}));

vi.mock('../../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../../../admin/plugins/workspace-plugin-store', () => ({
    getPluginGrantReview: async () => grantReviewMock(),
    setPluginGrantReview: async () => setGrantReviewMock(),
}));

const grantReviewMock = vi.fn(async () => ({ status: 'unreviewed', requestedGrants: [] }));
const setGrantReviewMock = vi.fn(async () => ({ status: 'current', requestedGrants: [] }));

vi.mock('../../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        packages: {},
        pointers: {},
        migration: { getStateVersion: async () => 1 },
        candidates: { prepare: () => prepareMock() },
    }),
    packageGrantCandidate: async () => ({
        requestedGrants: ['settings.read'],
        releaseId: null,
        packageDigest: `sha256-${'a'.repeat(64)}`,
        authoritySha256: `sha256-${'c'.repeat(64)}`,
        authority: null,
    }),
}));

vi.mock('../../../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: async () => [],
}));

vi.mock('../../../../../admin/plugins/package-tree', () => ({
    verifyPackageTree: async () => ({
        digest: `sha256-${'a'.repeat(64)}`,
        manifestDigest: `sha256-${'b'.repeat(64)}`,
    }),
}));

vi.mock('@or3/plugin-sdk/package-archive', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readPackageZip: () => readPackageZipMock(),
}));

vi.mock('../../../../../admin/plugins/package-route-catalog', () => ({
    PluginPackageRouteCatalog: class {
        async listSelected() {
            return [];
        }
    },
}));

vi.mock('../../../../../admin/plugins/v2-host-capabilities', () => ({
    OR3_PLUGIN_V2_HOST_CAPABILITIES: {},
}));

vi.mock('../../../../../utils/plugins/acquisition/release-metadata', () => ({
    acquisitionProfileRequirement: () => null,
}));

vi.mock('../../../../../utils/plugins/acquisition/config', () => ({
    DEFAULT_MAX_ARTIFACT_BYTES: 128 * 1024 * 1024,
}));

vi.mock('../../../../../utils/rate-limit', () => ({
    checkRateLimit: () => rateLimitMock(),
}));

vi.mock('../../../../../admin/plugins/local-admission', () => ({
    LOCAL_ADMISSION_PROVENANCE: 'local-development',
    recordLocalAdmission: () => recordMock(),
}));

vi.mock('../../../../../utils/plugins/development/development-eligibility', () => ({
    developmentIneligibilityHelp: (code: string) => code,
    resolvePluginDevelopmentEligibility: () => eligibilityMock(),
}));

import handler from '../admit.post';

function sha256Hex(bytes: Uint8Array): string {
    return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

const PACKAGE_BYTES = Buffer.from('candidate-package-bytes');
const SOURCE_BYTES = Buffer.from('candidate-source-bytes');

function receiptFor(overrides: Record<string, unknown> = {}) {
    const source = { revision: 'abc123', dirty: false };
    const build = {
        bunVersion: 'bun-1.3.6',
        sdkVersion: '2.0.0',
        sdkArtifactSha256: `sha256-${'e'.repeat(64)}` as `sha256-${string}`,
        lockfileSha256: null,
        command: 'or3-plugin candidate . --out candidate',
    };
    return {
        schemaVersion: 1,
        pluginId: 'or3.sample-utility',
        version: '0.2.0',
        profile: 'or3-portable-client-v1',
        archiveSha256: sha256Hex(PACKAGE_BYTES),
        packageTreeSha256: `sha256-${'a'.repeat(64)}`,
        manifestSha256: `sha256-${'b'.repeat(64)}`,
        sourceSha256: sha256Hex(SOURCE_BYTES),
        authoritySha256: `sha256-${'d'.repeat(64)}`,
        buildProvenanceSha256: buildProvenanceSha256(source, build),
        requiredHostFeatures: ['or3-portable-client-v1'],
        source,
        build,
        ...overrides,
    };
}

function partsFor(receipt: unknown) {
    return [
        { name: 'package', data: PACKAGE_BYTES },
        { name: 'source', data: SOURCE_BYTES },
        { name: 'receipt', data: Buffer.from(JSON.stringify(receipt)) },
        { name: 'workspaceId', data: Buffer.from('ws-1') },
    ];
}

/** Parts with a well-formed source snapshot, so the flow reaches package verification. */
function verifiableParts(receipt: unknown) {
    const entries = [{ path: 'client.mjs', bytes: Buffer.from('export default 1;\n') }];
    const receiptWithSource = {
        ...(receipt as Record<string, unknown>),
        sourceSha256: hashSnapshotEntries(entries),
    };
    return [
        { name: 'package', data: PACKAGE_BYTES },
        { name: 'source', data: Buffer.from(encodeFileZip(entries)) },
        { name: 'receipt', data: Buffer.from(JSON.stringify(receiptWithSource)) },
        { name: 'workspaceId', data: Buffer.from('ws-1') },
    ];
}

const event = { node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: {} } }, context: {} } as never;

beforeEach(() => {
    eligibilityMock.mockReset().mockReturnValue({ eligible: true, reasons: [], profileRoot: '/tmp/profile' });
    rateLimitMock.mockReset().mockResolvedValue(true);
    recordMock.mockReset().mockResolvedValue(undefined);
    readPackageZipMock.mockReset().mockRejectedValue(new Error('not a package archive'));
    multipartParts = null;
});

describe('development admission boundary', () => {
    it('rejects an ineligible host before reading uploads', async () => {
        eligibilityMock.mockReturnValue({ eligible: false, reasons: ['production-build'], profileRoot: null });
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 403,
            data: { code: 'development-host-ineligible' },
        });
        expect(recordMock).not.toHaveBeenCalled();
    });

    it('rejects a malformed receipt', async () => {
        multipartParts = partsFor({ schemaVersion: 1, pluginId: 'nope' });
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: { code: 'candidate-receipt-invalid' },
        });
    });

    it('rejects non-portable profiles', async () => {
        multipartParts = partsFor(receiptFor({ profile: 'or3-trusted-host-v1' }));
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 422,
            data: { code: 'candidate-profile-unsupported' },
        });
    });

    it('rejects package bytes that do not match the receipt', async () => {
        multipartParts = partsFor(receiptFor({ archiveSha256: `sha256-${'f'.repeat(64)}` }));
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 422,
            data: { code: 'candidate-archive-mismatch' },
        });
    });

    it('rejects source bytes that do not match the receipt', async () => {
        multipartParts = partsFor(receiptFor({ sourceSha256: `sha256-${'f'.repeat(64)}` }));
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 422,
            data: { code: 'candidate-source-mismatch' },
        });
    });

    it('refuses archives that fail canonical verification', async () => {
        // A well-formed source snapshot lets the flow reach package
        // verification, where the garbage package bytes are refused.
        multipartParts = verifiableParts(receiptFor());
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 422,
            data: { code: 'candidate-verification-failed' },
        });
        expect(recordMock).not.toHaveBeenCalled();
    });

    it('requires all three files together', async () => {
        multipartParts = [{ name: 'package', data: PACKAGE_BYTES }];
        await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
    });
    it('reports denied authority without recording provenance', async () => {
        readPackageZipMock.mockResolvedValueOnce({
            digest: `sha256-${'a'.repeat(64)}`,
            entries: 3,
            extractedRoot: null,
        });
        multipartParts = verifiableParts(receiptFor());
        const result = (await handler(event)) as { ok: boolean; stage: string; codes: readonly string[] };
        expect(result.ok).toBe(false);
        expect(result.stage).toBe('grants');
        expect(result.codes).toEqual(['grant-review-required']);
        expect(recordMock).not.toHaveBeenCalled();
    });

    it('records explicit digest-bound approval, then stages the candidate', async () => {
        readPackageZipMock.mockResolvedValueOnce({
            digest: `sha256-${'a'.repeat(64)}`,
            entries: 3,
            extractedRoot: null,
        });
        prepareMock.mockResolvedValueOnce({
            status: 'candidate-stored',
            pointerUnchanged: false,
            stored: {
                digest: `sha256-${'a'.repeat(64)}`,
                verification: { manifestDigest: `sha256-${'b'.repeat(64)}` },
            },
            pointer: { revision: 1 },
        });
        const receipt = receiptFor();
        const approvalParts = [
            ...verifiableParts(receipt),
            { name: 'approvedGrants', data: Buffer.from(JSON.stringify(['settings.read'])) },
            { name: 'expectedPackageDigest', data: Buffer.from(receipt.packageTreeSha256 as string) },
            // The echoed authority is the tree-derived review identity the
            // blocked response returned, not the receipt's informational digest.
            { name: 'expectedAuthoritySha256', data: Buffer.from(`sha256-${'c'.repeat(64)}`) },
        ];
        multipartParts = approvalParts;
        const result = (await handler(event)) as { ok: boolean; packageDigest: string; provenance: string };
        expect(result.ok).toBe(true);
        expect(result.provenance).toBe('local-development');
        expect(setGrantReviewMock).toHaveBeenCalledOnce();
        expect(recordMock).toHaveBeenCalledOnce();
    });
});
