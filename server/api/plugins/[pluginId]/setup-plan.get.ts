import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { resolveConnectionService } from '../../../utils/plugins/connections/resolve';
import { loadSetupState, type SetupState } from '../../../utils/plugins/setup/state';
import {
    bindCandidateOperation,
    resolvePluginPackage,
    type ResolvedPluginPackage,
} from '../../../utils/plugins/setup/discovery';

function sameSelectionIdentity(
    left: ResolvedPluginPackage | null,
    right: ResolvedPluginPackage | null
): boolean {
    if (left === null || right === null) return left === right;
    return (
        left.status === right.status &&
        left.digest === right.digest &&
        left.selectedSlot === right.selectedSlot &&
        left.pointerRevision === right.pointerRevision
    );
}

/**
 * Returns the host-rendered setup plan for one installed package in the active
 * workspace: required settings, connection bindings, test action and first action.
 *
 * This endpoint and the first-action endpoint build their view from the same
 * loader, so a GET cannot report Ready while the POST refuses for a required
 * field that has no value.
 *
 * The plan is built from one verified selection and its bound acquisition
 * operation, and the values and revision come from one settings read, so a
 * concurrent write or promotion cannot pair stale values with a newer revision
 * or a plan with the wrong operation. A package identity change between the
 * selection and the settings read is retried once, then reported as a conflict.
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
    // handoff receives it, so readiness and the handoff agree. A runtime settings
    // read asks for `slot=current` so it never follows an unpromoted candidate.
    const query = getQuery(event);
    const hasSelectedContext =
        (typeof query.documentId === 'string' && query.documentId.length > 0) ||
        (typeof query.messageId === 'string' && query.messageId.length > 0);
    const slot = query.slot === 'current' ? ('current' as const) : undefined;

    const { service, durable } = resolveConnectionService();

    let selection = await resolvePluginPackage(
        pluginId,
        EXTENSIONS_BASE_DIR,
        slot ?? 'auto'
    );
    let state: SetupState;
    let ownedOperationId: string | null = null;
    for (let attempt = 0; ; attempt += 1) {
        ownedOperationId = null;
        // A candidate is only usable when the acquisition that owns its exact
        // digest is live; an orphaned candidate is refused, never rendered as a
        // plan whose operation silently disappeared.
        if (selection?.status === 'candidate' && selection.digest) {
            const binding = await bindCandidateOperation({
                pluginId,
                workspaceId,
                candidateDigest: selection.digest,
                settingsStore: getWorkspaceSettingsStore(event),
            });
            if (!binding.ok) {
                throw createError({
                    statusCode: 409,
                    statusMessage: binding.message,
                    data: { code: binding.code },
                });
            }
            ownedOperationId = binding.operationId;
        }
        state = await loadSetupState({
            event,
            pluginId,
            workspaceId,
            ownerUserId: userId,
            hasSelectedContext,
            service,
            durableConnections: durable,
            ...(selection ? { selection } : {}),
            ...(ownedOperationId === null ? {} : { setupOperationId: ownedOperationId }),
            ...(slot === undefined ? {} : { slot }),
        });
        // Promotion or rollback can move the package between the selection and
        // the settings read. Retry once against the new identity; a second
        // change is reported so the caller reloads instead of saving against a
        // plan built from a different package.
        const recheck = await resolvePluginPackage(
            pluginId,
            EXTENSIONS_BASE_DIR,
            slot ?? 'auto'
        );
        if (sameSelectionIdentity(selection, recheck)) break;
        if (attempt >= 1) {
            throw createError({
                statusCode: 409,
                statusMessage:
                    'The package changed while the setup plan was being built. Reload and try again.',
                data: { code: 'setup-package-conflict' },
            });
        }
        selection = recheck;
    }

    if (!state.installed) {
        if (state.selection?.status === 'blocked') {
            throw createError({
                statusCode: 409,
                statusMessage:
                    'This plugin package is blocked; its selected version could not be verified.',
                data: { code: 'plugin-package-blocked', issues: state.selection.issues },
            });
        }
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
        packageDigest: state.packageDigest,
        selectionStatus: state.selection?.status ?? null,
        operationId: ownedOperationId,
        // Values and revision come from the same settings read.
        setupRevision: state.setupRevision,
        // Hydration source: validated saved settings, plus field-level problems.
        settings: { values: state.values, errors: state.settingsErrors },
        selectionRequired:
            state.plan !== null &&
            !(typeof state.plan.firstAction.samplePath === 'string' &&
              state.plan.firstAction.samplePath.length > 0),
    };
});
