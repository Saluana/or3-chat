/**
 * POST /api/admin/plugins/development/admit
 *
 * Purpose:
 * Admit one owner-selected SDK candidate (package.zip + source.zip +
 * receipt.json) into the dedicated development instance only.
 *
 * Behavior:
 * 1. Owner authentication, same-origin mutation context and rate limiting
 *    apply exactly as for other admin mutations.
 * 2. The development eligibility gate (flag, dev build, dedicated profile,
 *    loopback socket) rejects anything else, including production builds with
 *    the flag set.
 * 3. The receipt is validated and every digest recomputed from the uploaded
 *    bytes; the package archive passes the same canonical archive protections
 *    as signed acquisitions. Nothing is rebuilt or re-signed here.
 * 4. The extracted tree passes the existing feature/authority/setup/state
 *    checks through managed candidate recording. Grants still need explicit
 *    workspace approval, and the canary/promote routes still run before
 *    anything is selected.
 * 5. Success records explicit local-development provenance for the digest. It
 *    never fabricates a marketplace signature or touches the signed registry,
 *    and it never alters the ordinary raw-upload policy.
 *
 * Constraints:
 * - Multipart only (`package`, `source`, `receipt`, optional `workspaceId`).
 * - Replacing a candidate of the same version writes a new provenance record
 *   for the new digest; plugin data is preserved, never cleared.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createError, defineEventHandler, readMultipartFormData } from 'h3';
import { parseCandidateReceipt, buildProvenanceSha256, hashSnapshotEntries } from '@or3/plugin-sdk/candidate';
import { readFileZipEntries, readPackageZip } from '@or3/plugin-sdk/package-archive';
import { requireAdminApiContext } from '../../../../admin/api';
import { getClientIp } from '../../../../admin/auth/rate-limit';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../../admin/stores/registry';
import { getPluginGrantReview } from '../../../../admin/plugins/workspace-plugin-store';
import {
    packageGrantCandidate,
    pluginPackageServices,
} from '../../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../../admin/plugins/package-route-catalog';
import { listInstalledExtensions } from '../../../../admin/extensions/extension-manager';
import { verifyPackageTree } from '../../../../admin/plugins/package-tree';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../../admin/plugins/v2-host-capabilities';
import { acquisitionProfileRequirement } from '~~/shared/plugins/acquisition/release-metadata';
import { DEFAULT_MAX_ARTIFACT_BYTES } from '../../../../utils/plugins/acquisition/config';
import { checkRateLimit } from '../../../../utils/rate-limit';
import {
    LOCAL_ADMISSION_PROVENANCE,
    recordLocalAdmission,
} from '../../../../admin/plugins/local-admission';
import {
    developmentIneligibilityHelp,
    resolvePluginDevelopmentEligibility,
} from '../../../../utils/plugins/development/development-eligibility';

const MAX_RECEIPT_BYTES = 64 * 1024;

function sha256Hex(bytes: Uint8Array): string {
    return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

function fieldText(fields: { name?: string; data?: unknown }[], name: string): string | undefined {
    const field = fields.find((entry) => entry.name === name);
    if (!field || !('data' in field)) return undefined;
    const text = Buffer.from(field.data as Uint8Array).toString('utf8').trim();
    return text.length > 0 ? text : undefined;
}

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
            statusMessage: `Development admission is not available here: ${eligibility.reasons.map(developmentIneligibilityHelp).join(' ')}`,
            data: { code: 'development-host-ineligible', reasons: eligibility.reasons },
        });
    }

    const allowed = await checkRateLimit(`plugin-development:admit:${getClientIp(event)}`, {
        max: 30,
        window: 3600,
    });
    if (!allowed) {
        throw createError({ statusCode: 429, statusMessage: 'Too many development admission requests.' });
    }

    const form = await readMultipartFormData(event);
    const packagePart = form?.find((entry) => entry.name === 'package' && 'data' in entry);
    const sourcePart = form?.find((entry) => entry.name === 'source' && 'data' in entry);
    const receiptPart = form?.find((entry) => entry.name === 'receipt' && 'data' in entry);
    if (!packagePart || !('data' in packagePart) || !sourcePart || !('data' in sourcePart) || !receiptPart || !('data' in receiptPart)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Upload the candidate package.zip, source.zip and receipt.json together.',
        });
    }
    const packageBytes = Buffer.from(packagePart.data);
    const sourceBytes = Buffer.from(sourcePart.data);
    const receiptBytes = Buffer.from(receiptPart.data);
    if (packageBytes.byteLength === 0 || packageBytes.byteLength > DEFAULT_MAX_ARTIFACT_BYTES) {
        throw createError({ statusCode: 413, statusMessage: 'The candidate package exceeds the artifact byte ceiling.' });
    }
    if (receiptBytes.byteLength > MAX_RECEIPT_BYTES) {
        throw createError({ statusCode: 413, statusMessage: 'The candidate receipt exceeds 64 KiB.' });
    }

    let receipt;
    try {
        receipt = parseCandidateReceipt(JSON.parse(receiptBytes.toString('utf8')));
        if (buildProvenanceSha256(receipt.source, receipt.build) !== receipt.buildProvenanceSha256) {
            throw new Error('Candidate receipt provenance does not match its recorded source/build inputs.');
        }
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: error instanceof Error ? `Invalid candidate receipt: ${error.message}` : 'Invalid candidate receipt.',
            data: { code: 'candidate-receipt-invalid' },
        });
    }
    if (receipt.profile !== 'or3-portable-client-v1') {        throw createError({
            statusCode: 422,
            statusMessage: `Development admission supports the portable profile only; the receipt declares ${receipt.profile}.`,
            data: { code: 'candidate-profile-unsupported' },
        });
    }
    if (sha256Hex(packageBytes) !== receipt.archiveSha256) {
        throw createError({
            statusCode: 422,
            statusMessage: 'The uploaded package.zip does not match the receipt archive digest.',
            data: { code: 'candidate-archive-mismatch' },
        });
    }
    // The receipt binds the source content identity, not the archive bytes:
    // decode the snapshot and recompute it from the exact uploaded files.
    let sourceEntries: { readonly path: string; readonly bytes: Uint8Array }[];
    try {
        sourceEntries = await readFileZipEntries(new Uint8Array(sourceBytes));
    } catch (error) {
        throw createError({
            statusCode: 422,
            statusMessage: error instanceof Error ? `The uploaded source.zip failed verification: ${error.message}` : 'The uploaded source.zip failed verification.',
            data: { code: 'candidate-source-mismatch' },
        });
    }
    if (hashSnapshotEntries(sourceEntries) !== receipt.sourceSha256) {
        throw createError({
            statusCode: 422,
            statusMessage: 'The uploaded source.zip content does not match the receipt source digest.',
            data: { code: 'candidate-source-mismatch' },
        });
    }

    const workspaceId = resolveAdminWorkspaceTarget(
        adminContext,
        fieldText(form ?? [], 'workspaceId')
    );
    const settings = getWorkspaceSettingsStore(event);
    const services = pluginPackageServices(settings);

    const treeRoot = join(
        await fs.mkdtemp(join(tmpdir(), 'or3-local-candidate-')),
        'tree'
    );
    await fs.mkdir(treeRoot, { recursive: true });
    try {
        let extracted;
        try {
            extracted = await readPackageZip(new Uint8Array(packageBytes), {
                extractDirectory: treeRoot,
            });
        } catch (error) {
            throw createError({
                statusCode: 422,
                statusMessage: error instanceof Error ? `The candidate archive failed verification: ${error.message}` : 'The candidate archive failed verification.',
                data: { code: 'candidate-verification-failed' },
            });
        }
        if (extracted.digest !== receipt.packageTreeSha256) {
            throw createError({
                statusCode: 422,
                statusMessage: 'The extracted package tree does not match the receipt package digest.',
                data: { code: 'candidate-package-mismatch' },
            });
        }
        const verification = await verifyPackageTree(treeRoot, {
            expectedDigest: receipt.packageTreeSha256,
        });
        if (verification.manifestDigest !== receipt.manifestSha256) {
            throw createError({
                statusCode: 422,
                statusMessage: 'The package manifest does not match the receipt manifest digest.',
                data: { code: 'candidate-manifest-mismatch' },
            });
        }

        const requirement = acquisitionProfileRequirement(receipt.profile);
        const selectedPackages = await new PluginPackageRouteCatalog(
            services.packages,
            services.pointers
        ).listSelected();
        const ready = selectedPackages.filter((catalog) => catalog.status === 'ready');
        const result = await services.candidates.prepare({
            pluginId: receipt.pluginId,
            sourceRoot: treeRoot,
            expectedDigest: receipt.packageTreeSha256,
            host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
            availableDependencies: ready.map((catalog) => ({
                id: catalog.pluginId,
                version: catalog.manifest.version,
                features: [...catalog.manifest.features.required, ...catalog.manifest.features.optional],
            })),
            dependencyNodes: ready.map((catalog) => ({
                id: catalog.pluginId,
                version: catalog.manifest.version,
                dependencies: catalog.manifest.dependencies,
            })),
            grantReview: await getPluginGrantReview(
                settings,
                workspaceId,
                receipt.pluginId,
                await packageGrantCandidate({ packagePath: treeRoot, packageDigest: null })
            ),
            storedStateVersion: await services.migration.getStateVersion(workspaceId, receipt.pluginId),
            identityPreflight: async () => {
                const legacyConflict = (await listInstalledExtensions()).some(
                    (extension) => extension.kind === 'plugin' && extension.id === receipt.pluginId
                );
                return legacyConflict
                    ? { status: 'blocked' as const, codes: ['plugin-id-conflicts-with-legacy-extension'] }
                    : { status: 'eligible' as const, codes: [] };
            },
            // The receipt declares the portable profile; the bytes must agree
            // with it exactly as a signed release would have to.
            loaderPreflight: ({ manifest }) => {
                const codes: string[] = [];
                if (!requirement) codes.push('package-profile-unknown');
                else {
                    if (manifest.trust !== requirement.trust) codes.push('package-profile-trust-mismatch');
                    if (manifest.runtime.server) codes.push('package-profile-server-runtime-forbidden');
                    if (!manifest.runtime.client) codes.push('package-profile-client-runtime-missing');
                }
                if (manifest.id !== receipt.pluginId || manifest.version !== receipt.version) {
                    codes.push('candidate-identity-mismatch');
                }
                return codes.length === 0
                    ? { status: 'eligible' as const, codes: [] }
                    : { status: 'blocked' as const, codes };
            },
        });
        if (result.status === 'blocked') {
            return {
                ok: false,
                provenance: LOCAL_ADMISSION_PROVENANCE,
                workspaceId,
                stage: result.stage,
                codes: result.codes,
            };
        }

        const principal = adminContext.principal;
        const admittedBy = principal.kind === 'super_admin' ? principal.username : principal.userId;
        try {
            await recordLocalAdmission({
                schemaVersion: 1,
                pluginId: receipt.pluginId,
                packageDigest: result.stored.digest,
                manifestDigest: result.stored.verification.manifestDigest,
                archiveSha256: receipt.archiveSha256,
                sourceSha256: receipt.sourceSha256,
                receiptSha256: sha256Hex(receiptBytes) as `sha256-${string}`,
                candidateVersion: receipt.version,
                admittedAt: new Date().toISOString(),
                admittedBy,
            });
        } catch (error) {
            // The candidate is safely staged; only the provenance sidecar
            // failed (for example a concurrent retry already recorded it).
            if (!(error instanceof Error && 'code' in error && (error as { code?: string }).code === 'EEXIST')) {
                throw error;
            }
        }
        await event.context.adminHooks?.doAction('admin.plugin:action:candidate-prepared', {
            id: receipt.pluginId,
            workspaceId,
            packageDigest: result.stored.digest,
            provenance: LOCAL_ADMISSION_PROVENANCE,
        });
        return {
            ok: true,
            provenance: LOCAL_ADMISSION_PROVENANCE,
            pluginId: receipt.pluginId,
            workspaceId,
            version: receipt.version,
            packageDigest: result.stored.digest,
            pointer: result.pointer,
        };
    } finally {
        await fs.rm(treeRoot, { recursive: true, force: true }).catch(() => {});
    }
});
