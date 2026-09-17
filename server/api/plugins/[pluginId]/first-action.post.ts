import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { resolveConnectionService } from '../../../utils/plugins/connections/resolve';
import { resolveSetupPlan } from '../../../utils/plugins/setup/setup-plan';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import {
    buildFirstActionHandoff,
    type SetupPlan,
} from '~~/shared/plugins/setup/plan';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
import { SelectionHandleAuthority } from '~~/shared/plugins/authority/effective-authority';

type FirstActionBody = {
    readonly documentId?: unknown;
    readonly messageId?: unknown;
};

/**
 * Host-mediated first-action handoff.
 *
 * The host decides the context (the user's selection or the package sample),
 * mints a generation-bound handle for it, and returns the declared action. The
 * plugin never receives a raw document or workspace identifier, and the action
 * itself runs inside the sandbox runtime through the broker.
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
    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    if (!installed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }

    const body = await readLimitedJsonBody<FirstActionBody>(event);
    const documentId = typeof body?.documentId === 'string' ? body.documentId : undefined;
    const messageId = typeof body?.messageId === 'string' ? body.messageId : undefined;

    const { service } = resolveConnectionService();
    const resolved = await resolveSetupPlan({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: installed.path,
        pluginId,
        workspaceId,
        ownerUserId: userId,
        service,
    });
    if (!resolved.plan) {
        throw createError({
            statusCode: 409,
            statusMessage: 'Setup information is unavailable for this plugin',
        });
    }

    const plan: SetupPlan = resolved.plan;
    const handoff = buildFirstActionHandoff({
        plan,
        hasSelectedContext: Boolean(documentId || messageId),
    });
    if (!handoff.ready) {
        return { status: 'needs-setup', handoff, blockers: plan.blockers };
    }

    const authority = new SelectionHandleAuthority({
        pluginId,
        workspaceId,
        generation: 1,
    });
    const handle = authority.mint(
        handoff.contextKind === 'sample'
            ? { kind: 'document', contextId: 'package-sample' }
            : documentId
              ? { kind: 'document', contextId: documentId }
              : { kind: 'message', contextId: messageId! }
    );

    return {
        status: 'ready',
        handoff,
        handle: { handleId: handle.handleId, kind: handle.kind, generation: handle.generation },
    };
});
