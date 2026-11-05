import { defineEventHandler } from 'h3';
import { requireWorkspaceSession } from './_helpers';
import { setNoCacheHeaders } from '../../utils/headers';
import { readWorkspaceModels } from '../../utils/chat/workspace-models';
export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    const session = await requireWorkspaceSession(event);
    return readWorkspaceModels(event, session.workspace!.id);
});
