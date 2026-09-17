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
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../admin/plugins/v2-host-capabilities';
import { resolveConnectionService } from '../connections/resolve';
import { loadSetupState } from '../setup/state';
import { readSetupValues } from '../setup/settings-store';
import {
    pluginPackageServices,
} from '../../../admin/plugins/package-operation-support';
import { CLIENT_CANARY_PENDING_CODE } from '../../../admin/plugins/candidate-client-canary';
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
        supportedProfiles: config.supportedProfiles,
        trustRoot: {
            supportedProfiles: config.supportedProfiles,
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

/**
 * Setup readiness for the candidate package, using the same host plan (settings
 * and stored connections) the setup page renders. Returns `null` when the package
 * declares no setup at all.
 */
async function setupPlanFor(event: H3Event, requesterUserId: string) {
    return async (pluginId: string, workspaceId: string, packageRoot: string) => {
        void packageRoot;
        const { service, durable } = resolveConnectionService();
        const state = await loadSetupState({
            pluginId,
            workspaceId,
            ownerUserId: requesterUserId,
            hasSelectedContext: false,
            service,
            durableConnections: durable,
            storedValues: await readSetupValues(event, workspaceId, pluginId),
        });
        return state.plan;
    };
}

export async function acquisitionServiceFor(
    event: H3Event,
    requesterUserId = ''
): Promise<PluginAcquisitionService> {
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
        hostCapabilities: OR3_PLUGIN_V2_HOST_CAPABILITIES,
        setupPlan: await setupPlanFor(event, requesterUserId),
        // A client profile is only satisfied by evidence a real browser
        // recorded for this candidate; a server process cannot produce it.
        clientCanary: async (input) => {
            const evidence = await services.clientCanary.readEvidence(
                input.pluginId,
                input.packageDigest,
                input.workspaceId
            );
            if (!evidence) return { status: 'blocked', code: CLIENT_CANARY_PENDING_CODE };
            if (evidence.status === 'blocked') {
                return { status: 'blocked', code: evidence.code ?? 'client-canary-blocked' };
            }
            return { status: 'passed' };
        },
        listWorkspaceIds: () => listAllWorkspaceIds(event),
        listInstalledExtensionIds: async () =>
            (await listInstalledExtensions())
                .filter((extension) => extension.kind === 'plugin')
                .map((extension) => extension.id),
        registryState,
    });
}
