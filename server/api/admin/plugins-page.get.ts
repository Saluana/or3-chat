/**
 * @module server/api/admin/plugins-page.get
 *
 * Purpose:
 * Optimization endpoint for the Admin Plugins Page.
 *
 * Responsibilities:
 * - Aggregates installed plugins and their enabled status for the current workspace
 * - Reduces round-trips for initial page load
 */
import { defineEventHandler, getQuery } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getEnabledPlugins, getPluginGrantReview } from '../../admin/plugins/workspace-plugin-store';
import { getWorkspaceAccessStore, getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { isSuperAdmin } from '../../admin/context';
import { ImmutablePluginPackageStore } from '../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../admin/plugins/package-pointer-store';
import { PluginPackageRouteCatalog } from '../../admin/plugins/package-route-catalog';
import { readLocalAdmission } from '../../admin/plugins/local-admission';
import { readAdminUploadProvenance } from '../../admin/plugins/admin-upload-provenance';
import { packageGrantCandidate } from '../../admin/plugins/package-operation-support';
import { SitePluginPolicyStore } from '../../admin/plugins/site-policy';
import { ensureSitePolicyMigrated } from '../../admin/plugins/site-policy-service';
import { resolveConnectionService } from '../../utils/plugins/connections/resolve';
import { loadSetupState } from '../../utils/plugins/setup/state';
import { packageNeedsNoSetup } from '../../admin/plugins/setup-readiness';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';

/**
 * GET /api/admin/plugins-page
 *
 * Purpose:
 * Serves all necessary data for the Plugin management screen.
 *
 * Behavior:
 * - Validates workspace context.
 * - Fetches registry of all plugins + current workspace enabled state in parallel.
 *
 * Performance:
 * - Replaces 2 separate calls => ~50% latency reduction.
 */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        allowWorkspaceAdmin: true,
    });
    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        getQuery(event).workspaceId
    );
    
    const settingsStore = getWorkspaceSettingsStore(event);
    const canManageSitePlugins = isSuperAdmin(context);
    
    // Parallel fetch instead of sequential
    const [extensions, enabledPlugins] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId)
    ]);
    const packagePlugins = canManageSitePlugins
        ? await (async () => {
              const sitePolicies = new SitePluginPolicyStore();
              const sitePolicyReady = await ensureSitePolicyMigrated(sitePolicies).then(() => true).catch(() => false);
              const workspace = await getWorkspaceAccessStore(event).getWorkspace({ workspaceId });
              const connections = resolveConnectionService();
              const packages = new ImmutablePluginPackageStore();
              const pointers = new PluginPackagePointerStore(undefined, packages);
              // Pointer slots hold digests only, so the version a package is
              // running (or waiting to run) is read from the stored manifest of
              // the exact slot. The UI renders this DTO instead of guessing a
              // version field the pointer does not have.
              const routeCatalog = new PluginPackageRouteCatalog(packages, pointers);
              const versionFor = async (pluginId: string, digest: Sha256 | null) => {
                  if (!digest) return null;
                  const read = await routeCatalog.readManifest(pluginId, digest).catch(() => null);
                  return read?.status === 'ready' ? read.manifest.version : null;
              };
              const pluginIds = await pointers.listPluginIds();
              return await Promise.all(pluginIds.map(async (pluginId) => {
                  const [pointer, startup] = await Promise.all([
                      pointers.readPointer(pluginId).catch(() => null),
                      pointers.readStartupSelection(pluginId).catch(() => null),
                  ]);
                  const selectedDigest = startup?.selected?.packageDigest ?? null;
                  const candidateDigest = pointer?.candidate?.packageDigest ?? null;
                  const [version, candidateVersion, candidateAdmission, candidateUpload, selectedAdmission, sitePolicy] = await Promise.all([
                      versionFor(pluginId, selectedDigest),
                      versionFor(pluginId, candidateDigest),
                      // Provenance follows the selected bytes: a promoted
                      // development candidate keeps its local identity.
                      (async () => {
                          for (const digest of [candidateDigest, selectedDigest]) {
                              if (!digest) continue;
                              const record = await readLocalAdmission(pluginId, digest).catch(() => null);
                              if (record) return record;
                          }
                          return null;
                      })(),
                      candidateDigest ? readAdminUploadProvenance(pluginId, candidateDigest).catch(() => null) : null,
                      selectedDigest ? Promise.all([
                          readLocalAdmission(pluginId, selectedDigest),
                          readAdminUploadProvenance(pluginId, selectedDigest),
                      ]).then(([local, upload]) => local || upload).catch(() => null) : null,
                      sitePolicies.read(pluginId).catch(() => null),
                  ]);
                  const grantReview = selectedDigest && startup?.status === 'ready'
                      ? await (async () => {
                          try {
                              const candidate = await packageGrantCandidate({
                                  packagePath: packages.packagePath(pluginId, selectedDigest),
                                  packageDigest: selectedDigest,
                              });
                              return (await getPluginGrantReview(settingsStore, workspaceId, pluginId, candidate)).status === 'current'
                                  ? 'current' as const : 'required' as const;
                          } catch {
                              return 'unknown' as const;
                          }
                      })()
                      : 'unknown' as const;
                  const ownerUserId = workspace?.ownerUserId;
                  const setup = selectedDigest && startup?.status === 'ready' && ownerUserId
                      ? await packageNeedsNoSetup(packages, pluginId, selectedDigest).then((noSetup) => noSetup
                          ? 'ready' as const : loadSetupState({
                          event, pluginId, workspaceId, ownerUserId,
                          hasSelectedContext: false, service: connections.service,
                          durableConnections: connections.durable, slot: 'current',
                      }).then((state) => state.packageDigest === selectedDigest
                          ? state.status.status === 'ready' ? 'ready' as const
                              : state.status.status === 'needs-setup' ? 'required' as const : 'blocked' as const
                          : 'unknown' as const)).catch(() => 'unknown' as const)
                      : 'unknown' as const;
                  return {
                      pluginId,
                      pointer,
                      workspaceEnabled: enabledPlugins.includes(pluginId),
                      // Pending facts are explicit; neither package storage nor
                      // an admin cookie proves browser activation or setup.
                      siteApproval: selectedAdmission || (sitePolicy?.catalogVisible && sitePolicy.approvedRelease.packageTreeSha256 === selectedDigest)
                          ? 'approved' as const : sitePolicyReady ? 'required' as const : 'unknown' as const,
                      grantReview,
                      setup,
                      startup: {
                          status: startup?.status ?? 'blocked',
                          selectedSlot: startup?.selectedSlot ?? null,
                          selectedDigest,
                          issueCodes: startup?.issues.map((issue) => issue.code) ?? [
                              'pointer-unavailable',
                          ],
                      },
                      display: {
                          version,
                          selectedDigest,
                          candidateVersion,
                          candidateDigest,
                          canOpen: version !== null,
                      },
                      localAdmission: candidateAdmission
                          ? {
                                provenance: 'local-development' as const,
                                receiptSha256: candidateAdmission.receiptSha256,
                                admittedAt: candidateAdmission.admittedAt,
                            }
                          : null,
                      adminUpload: Boolean(candidateUpload || (selectedAdmission && 'uploadedBy' in selectedAdmission)),
                  };
              }));
          })()
        : [];
    
    return {
        plugins: extensions.filter(i => i.kind === 'plugin'),
        role: isSuperAdmin(context) ? 'owner' : context.session?.role,
        canManageSitePlugins,
        workspaceId,
        workspaceName:
            context.session?.workspace?.id === workspaceId
                ? context.session.workspace.name
                : undefined,
        enabledPlugins,
        packagePlugins,
    };
});
