/**
 * @module server/utils/plugins/acquisition/route-support
 *
 * Purpose:
 * Build the acquisition service for an admin request. Routes stay thin; the
 * wiring (stores, registry client, workspace enumeration) lives here so every
 * acquisition route observes the same policy and the same durable state.
 *
 * Behavior:
 * - The registry client is constructed with the host's persisted advisory
 *   sequence, so a replayed catalog cannot clear a revocation.
 * - The instance-wide workspace list is paged to completion (bounded), because a
 *   preflight that silently skipped workspaces would be worse than a refusal.
 *
 * Constraints:
 * - Server-only. Configuration is read from the process environment.
 *
 * Non-Goals:
 * - Authorization (the routes call the admin guard) and pipeline policy (the
 *   service owns it).
 */

import type { H3Event } from 'h3';
import { getWorkspaceAccessStore, getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { pluginPackageServices } from '../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';
import type { AcquisitionConfig } from './config';
import { acquisitionConfig } from './config';
import { PluginAcquisitionOperationStore } from './operation-store';
import { RegistryStateStore } from './registry-state';
import { RegistryClient } from './registry-client';
import { PluginAcquisitionService } from './acquisition-service';

const WORKSPACE_PAGE_SIZE = 100;
const MAX_WORKSPACE_PAGES = 100;

export function registryClientFor(
    config: AcquisitionConfig,
    acceptedAdvisorySequence: number
): RegistryClient {
    return new RegistryClient({
        registryOrigin: config.registryOrigin,
        trustRoot: {
            releaseKeys: config.releaseKeys,
            hostOr3Version: config.hostOr3Version,
            hostPluginApiVersion: config.hostPluginApiVersion,
            acceptedAdvisorySequence,
        },
        maxArtifactBytes: config.maxArtifactBytes,
        reserveBytes: config.reserveBytes,
        acceptedAdvisorySequence,
    });
}

/** Every live workspace id on this instance, paged to completion. */
export async function listAllWorkspaceIds(event: H3Event): Promise<readonly string[]> {
    const access = getWorkspaceAccessStore(event);
    const ids: string[] = [];
    for (let page = 1; page <= MAX_WORKSPACE_PAGES; page += 1) {
        const result = await access.listWorkspaces({
            page,
            perPage: WORKSPACE_PAGE_SIZE,
            includeDeleted: false,
        });
        for (const item of result.items) {
            if (!item.deleted) ids.push(item.id);
        }
        if (result.items.length < WORKSPACE_PAGE_SIZE) break;
    }
    return ids;
}

export async function acquisitionServiceFor(event: H3Event): Promise<PluginAcquisitionService> {
    const config = acquisitionConfig();
    const settings = getWorkspaceSettingsStore(event);
    const services = pluginPackageServices(settings);
    const registryState = new RegistryStateStore();
    const state = await registryState.read();
    return new PluginAcquisitionService({
        config,
        store: new PluginAcquisitionOperationStore(),
        registry: registryClientFor(config, state.acceptedAdvisorySequence),
        services,
        routeCatalog: new PluginPackageRouteCatalog(services.packages, services.pointers),
        listWorkspaceIds: () => listAllWorkspaceIds(event),
        listInstalledExtensionIds: async () =>
            (await listInstalledExtensions())
                .filter((extension) => extension.kind === 'plugin')
                .map((extension) => extension.id),
        registryState,
    });
}
