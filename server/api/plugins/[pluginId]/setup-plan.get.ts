import { createError, defineEventHandler, getRouterParam, getQuery } from 'h3';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { resolveConnectionService } from '../../../utils/plugins/connections/resolve';
import { resolveSetupPlan } from '../../../utils/plugins/setup/setup-plan';
import { loadPackageDescriptors } from '../../../utils/plugins/setup/load-descriptors';
import { buildFirstActionHandoff, describeSetupStatus } from '~~/shared/plugins/setup/plan';

/**
 * Returns the host-rendered setup plan for one installed package in the active
 * workspace: required settings, connection state, test action and first action.
 *
 * The plan is derived from the package's own descriptors and the workspace's
 * stored connections; nothing is invented when a descriptor is missing.
 */
export default defineEventHandler(async (event) => {
    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    const userId = session.user?.id;
    if (!workspaceId || !userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });

    const pluginId = getRouterParam(event, 'pluginId') ?? '';
    const query = getQuery(event);

    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    if (!installed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }

    // Saved settings live in the workspace settings store, keyed per plugin.
    let values: Record<string, string | number | boolean> = {};
    const store = getWorkspaceSettingsStore(event);
    const rawValues = await store.get(workspaceId, `plugin:${pluginId}:setup-values`);
    if (rawValues) {
        try {
            const parsed = JSON.parse(rawValues) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                values = parsed as Record<string, string | number | boolean>;
            }
        } catch {
            values = {};
        }
    }

    const { service, durable } = resolveConnectionService();
    const resolved = await resolveSetupPlan({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: installed.path,
        pluginId,
        workspaceId,
        ownerUserId: userId,
        service,
        values,
    });

    // Destinations come from the signed package policy, never from the caller,
    // so a connection test cannot be pointed at another origin.
    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: installed.path,
    });
    const destinations = (descriptors.policy?.destinations ?? []).map((destination) => ({
        id: destination.id,
        hosts: destination.hosts,
        methods: destination.methods,
        scopes: destination.scopes,
    }));

    if (!resolved.plan) {
        return {
            plan: null,
            status: { status: 'blocked' as const, label: 'Setup unavailable', blocked: true },
            problems: resolved.problems,
            destinations,
            durableConnections: durable,
        };
    }

    const hasSelectedContext =
        typeof query.hasSelection === 'string' ? query.hasSelection === 'true' : false;

    return {
        plan: resolved.plan,
        status: describeSetupStatus(resolved.plan),
        firstAction: buildFirstActionHandoff({
            plan: resolved.plan,
            hasSelectedContext,
        }),
        problems: resolved.problems,
        destinations,
        durableConnections: durable,
    };
});
