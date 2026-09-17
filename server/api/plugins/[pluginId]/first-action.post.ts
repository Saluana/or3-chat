import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { resolveConnectionService } from '../../../utils/plugins/connections/resolve';
import { loadSetupState } from '../../../utils/plugins/setup/state';
import { readSetupValues } from '../../../utils/plugins/setup/settings-store';
import {
    getRetainedSelectionAuthority,
    latestRetainedSelectionAuthority,
} from '../../../utils/plugins/setup/selection-authority-registry';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';

type FirstActionBody = {
    readonly documentId?: unknown;
    readonly messageId?: unknown;
    readonly generation?: unknown;
};

/** Ids are opaque to us, but they are still bounded before being carried. */
const CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Host-mediated first-action handoff.
 *
 * Readiness comes from the same loader the setup plan uses, so the two endpoints
 * cannot disagree. The host decides the context (the user's selection or the
 * package sample) and mints a handle only into a *live activation's* retained
 * authority, at that activation's current generation. Without a live activation
 * the handoff is reported as pending rather than handing back a handle that no
 * runtime could ever resolve.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
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

    const body = await readLimitedJsonBody<FirstActionBody | undefined>(event);
    const documentId =
        typeof body?.documentId === 'string' && CONTEXT_ID_PATTERN.test(body.documentId)
            ? body.documentId
            : undefined;
    const messageId =
        typeof body?.messageId === 'string' && CONTEXT_ID_PATTERN.test(body.messageId)
            ? body.messageId
            : undefined;
    const generation =
        typeof body?.generation === 'number' && Number.isInteger(body.generation)
            ? body.generation
            : undefined;

    const { service, durable } = resolveConnectionService();
    const state = await loadSetupState({
        pluginId,
        workspaceId,
        ownerUserId: userId,
        hasSelectedContext: Boolean(documentId || messageId),
        service,
        durableConnections: durable,
        storedValues: await readSetupValues(event, workspaceId, pluginId),
    });
    if (!state.installed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }
    if (!state.plan) {
        throw createError({
            statusCode: 409,
            statusMessage: 'Setup information is unavailable for this plugin',
        });
    }

    const handoff = state.firstAction;
    if (!handoff.ready) {
        return {
            status: handoff.reasonCode === 'selection-required' ? 'needs-selection' : 'needs-setup',
            handoff,
            blockers: state.plan.blockers,
        };
    }

    const selection = handoff.contextKind === 'sample'
        ? { kind: 'document' as const, contextId: 'package-sample' }
        : documentId
          ? { kind: 'document' as const, contextId: documentId }
          : { kind: 'message' as const, contextId: messageId! };

    // Only a live activation can resolve a handle; the host page supplies the
    // generation it is running, otherwise the most recent activation for this
    // plugin is used.
    const authority =
        generation === undefined
            ? latestRetainedSelectionAuthority(pluginId, workspaceId)
            : getRetainedSelectionAuthority(pluginId, workspaceId, generation);
    if (!authority) {
        return {
            status: 'pending-activation',
            handoff,
            selection: { kind: selection.kind },
            reason: 'Start the plugin before running its first action',
        };
    }

    const handle = authority.mint(selection);
    return {
        status: 'ready',
        handoff,
        handle: {
            handleId: handle.handleId,
            kind: handle.kind,
            generation: handle.generation,
        },
    };
});
