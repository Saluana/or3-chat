import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { resolveConnectionService } from '../../../utils/plugins/connections/resolve';
import { loadSetupState } from '../../../utils/plugins/setup/state';
import { readSetupValues } from '../../../utils/plugins/setup/settings-store';

/**
 * Returns the host-rendered setup plan for one installed package in the active
 * workspace: required settings, connection bindings, test action and first action.
 *
 * This endpoint and the first-action endpoint build their view from the same
 * loader, so a GET cannot report Ready while the POST refuses for a required
 * field that has no value.
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
    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    // The host UI carries a selection into this page the same way the first-action
    // handoff receives it, so readiness and the handoff agree.
    const query = getQuery(event);
    const hasSelectedContext =
        (typeof query.documentId === 'string' && query.documentId.length > 0) ||
        (typeof query.messageId === 'string' && query.messageId.length > 0);

    const { service, durable } = resolveConnectionService();
    const state = await loadSetupState({
        pluginId,
        workspaceId,
        ownerUserId: userId,
        hasSelectedContext,
        service,
        durableConnections: durable,
        storedValues: await readSetupValues(event, workspaceId, pluginId),
    });

    if (!state.installed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }

    return {
        plan: state.plan,
        status: state.status,
        firstAction: state.firstAction,
        problems: state.problems,
        destinations: state.destinations,
        durableConnections: state.durableConnections,
        credentialsAvailable: state.credentialsAvailable,
        // Hydration source: validated saved settings, plus field-level problems.
        settings: { values: state.values, errors: state.settingsErrors },
        selectionRequired:
            state.plan !== null && !state.plan.firstAction.usesSampleContext,
    };
});
