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
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { isSuperAdmin } from '../../admin/context';
import { ImmutablePluginPackageStore } from '../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../admin/plugins/package-pointer-store';
import { PluginPackageRouteCatalog } from '../../admin/plugins/package-route-catalog';
import { readLocalAdmission } from '../../admin/plugins/local-admission';
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
                  const [version, candidateVersion, candidateAdmission] = await Promise.all([
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
                  ]);
                  return {
                      pluginId,
                      pointer,
                      workspaceEnabled: enabledPlugins.includes(pluginId),
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
