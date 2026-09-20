/**
 * POST /api/admin/plugins/development/verification
 *
 * Purpose:
 * Export a scoped developer verification receipt for a locally admitted
 * candidate. The receipt binds the candidate, source and provenance digests to
 * the tested host build, scope and outcome. It is developer-supplied evidence:
 * it never substitutes for trusted marketplace validation, reviewer approval
 * or signer authorization, and it is only issued for local-development
 * provenance, never for signed catalog packages.
 *
 * Behavior:
 * - `runtime-canary` requires passed candidate-canary evidence (server and
 *   client steps) for the exact digest and workspace.
 * - `recorded-interaction-check` additionally requires an explicit developer
 *   attestation in the request body. It records that the developer exercised
 *   the plugin, not that any trusted party did.
 */
import { createError, defineEventHandler, readBody } from 'h3';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../admin/stores/registry';
import { pluginPackageServices } from '../../../../admin/plugins/package-operation-support';
import { readLocalAdmission } from '../../../../admin/plugins/local-admission';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../../admin/plugins/v2-host-capabilities';
import {
    developmentIneligibilityHelp,
    resolvePluginDevelopmentEligibility,
} from '../../../../utils/plugins/development/development-eligibility';

const BodySchema = z.object({
    pluginId: z.string().min(1).max(128),
    packageDigest: z.string().regex(/^sha256-[a-f0-9]{64}$/),
    workspaceId: z.string().min(1).optional(),
    scope: z.enum(['runtime-canary', 'recorded-interaction-check']),
    attestedInteraction: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
    const adminContext = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const eligibility = resolvePluginDevelopmentEligibility(event);
    if (!eligibility.eligible) {
        throw createError({
            statusCode: 403,
            statusMessage: `Development verification is not available here: ${eligibility.reasons.map(developmentIneligibilityHelp).join(' ')}`,
            data: { code: 'development-host-ineligible', reasons: eligibility.reasons },
        });
    }
    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(adminContext, body.data.workspaceId);
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));

    const admission = await readLocalAdmission(body.data.pluginId, body.data.packageDigest);
    if (!admission) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Developer verification receipts are issued for locally admitted candidates only.',
            data: { code: 'not-a-development-candidate' },
        });
    }
    if (body.data.scope === 'recorded-interaction-check' && body.data.attestedInteraction !== true) {
        throw createError({
            statusCode: 400,
            statusMessage: 'An interaction receipt needs your explicit attestation that you exercised the candidate.',
            data: { code: 'interaction-attestation-required' },
        });
    }

    // The canary is the only runtime evidence: both halves must have passed for
    // these exact bytes in this workspace.
    let canary: { server?: { status?: string }; client?: { status?: string } } | null = null;
    try {
        const raw = await fs.readFile(
            services.canary.evidencePath(body.data.pluginId, body.data.packageDigest as `sha256-${string}`, workspaceId),
            'utf8'
        );
        canary = JSON.parse(raw) as { server?: { status?: string }; client?: { status?: string } };
    } catch {
        canary = null;
    }
    if (canary?.server?.status !== 'passed' || canary?.client?.status !== 'passed') {
        throw createError({
            statusCode: 409,
            statusMessage: 'Run the candidate canary to a pass first; verification binds to that evidence.',
            data: { code: 'canary-evidence-required' },
        });
    }

    const receipt = {
        schemaVersion: 1,
        candidateReceiptSha256: admission.receiptSha256,
        hostBuild: `or3-host@${OR3_PLUGIN_V2_HOST_CAPABILITIES.or3Version}+development`,
        hostFeatures: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedFeatures],
        scope: body.data.scope,
        outcome: 'passed',
        recordedAt: new Date().toISOString(),
    } as const;
    return {
        ok: true,
        developerSupplied: true,
        trustedEvidence: false,
        receipt,
    };
});
