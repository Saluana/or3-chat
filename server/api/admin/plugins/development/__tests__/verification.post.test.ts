import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Verification receipts bind one local candidate to its canary evidence and
 * host. They are labeled developer-supplied and never stand in for trusted
 * validation.
 */
const eligibilityMock = vi.fn();
const admissionMock = vi.fn();
const evidencePathMock = vi.fn();
let evidenceBody: string | null = null;

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(options.statusMessage ?? 'error'), options),
    readBody: async () => requestBody,
}));

let requestBody: unknown = null;

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

vi.mock('../../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        canary: { evidencePath: () => evidencePathMock() },
    }),
}));

vi.mock('../../../../../admin/plugins/local-admission', () => ({
    readLocalAdmission: () => admissionMock(),
}));

vi.mock('../../../../../utils/plugins/development/development-eligibility', () => ({
    developmentIneligibilityHelp: (code: string) => code,
    resolvePluginDevelopmentEligibility: () => eligibilityMock(),
}));

import handler from '../verification.post';

const event = { node: { req: { socket: { remoteAddress: '127.0.0.1' }, headers: {} } }, context: {} } as never;
const DIGEST = `sha256-${'a'.repeat(64)}`;
let evidenceDir = '';

function passedEvidence() {
    return JSON.stringify({
        schemaVersion: 2,
        pluginId: 'or3.sample-utility',
        workspaceId: 'ws-1',
        packageDigest: DIGEST,
        server: { status: 'passed' },
        client: { status: 'passed' },
    });
}

beforeEach(() => {
    eligibilityMock.mockReset().mockReturnValue({ eligible: true, reasons: [], profileRoot: '/tmp/profile' });
    admissionMock.mockReset().mockResolvedValue({
        schemaVersion: 2,
        pluginId: 'or3.sample-utility',
        packageDigest: DIGEST,
        receiptSha256: `sha256-${'e'.repeat(64)}`,
        admittedAt: new Date(0).toISOString(),
    });
    if (evidenceDir) rmSync(evidenceDir, { recursive: true, force: true });
    evidenceDir = mkdtempSync(join(tmpdir(), 'or3-verification-'));
    evidenceBody = passedEvidence();
    const evidencePath = join(evidenceDir, 'evidence.json');
    writeFileSync(evidencePath, evidenceBody);
    evidencePathMock.mockReset().mockReturnValue(evidencePath);
    requestBody = { pluginId: 'or3.sample-utility', packageDigest: DIGEST, scope: 'runtime-canary' };
});

describe('development verification receipts', () => {
    it('exports a canary-bound receipt labeled developer-supplied', async () => {
        const result = (await handler(event)) as {
            ok: boolean;
            developerSupplied: boolean;
            trustedEvidence: boolean;
            receipt: Record<string, unknown>;
        };
        expect(result.ok).toBe(true);
        expect(result.developerSupplied).toBe(true);
        expect(result.trustedEvidence).toBe(false);
        expect(result.receipt).toMatchObject({
            schemaVersion: 1,
            candidateReceiptSha256: `sha256-${'e'.repeat(64)}`,
            scope: 'runtime-canary',
            outcome: 'passed',
        });
        expect(String(result.receipt.hostBuild)).toContain('development');
        expect(Array.isArray(result.receipt.hostFeatures)).toBe(true);
    });

    it('issues interaction receipts only with explicit attestation', async () => {
        requestBody = {
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            scope: 'recorded-interaction-check',
        };
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 400,
            data: { code: 'interaction-attestation-required' },
        });
        requestBody = {
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            scope: 'recorded-interaction-check',
            attestedInteraction: true,
        };
        const result = (await handler(event)) as { receipt: Record<string, unknown> };
        expect(result.receipt.scope).toBe('recorded-interaction-check');
    });

    it('refuses signed-catalog packages and missing canary evidence', async () => {
        admissionMock.mockResolvedValue(null);
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 404,
            data: { code: 'not-a-development-candidate' },
        });
        admissionMock.mockResolvedValue({
            schemaVersion: 2,
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            receiptSha256: `sha256-${'e'.repeat(64)}`,
            admittedAt: new Date(0).toISOString(),
        });
        writeFileSync(join(evidenceDir, 'evidence.json'), JSON.stringify({ server: { status: 'blocked' } }));
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'canary-evidence-required' },
        });
    });

    it('refuses export for pre-canonical (schema 1) admissions', async () => {
        admissionMock.mockResolvedValue({
            schemaVersion: 1,
            pluginId: 'or3.sample-utility',
            packageDigest: DIGEST,
            receiptSha256: `sha256-${'e'.repeat(64)}`,
            admittedAt: new Date(0).toISOString(),
        });
        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'receipt-hash-legacy' },
        });
    });

    it('rejects ineligible hosts', async () => {
        eligibilityMock.mockReturnValue({ eligible: false, reasons: ['production-build'], profileRoot: null });
        await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 });
    });
});
