/**
 * @module server/api/workflows/background.post
 *
 * Purpose:
 * Starts a background workflow execution job.
 */

import { defineEventHandler, readBody, createError, getHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { startBackgroundWorkflow } from '../../utils/workflows/background-execution';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = (await readBody(event).catch(() => null)) as
        | Record<string, unknown>
        | null;
    if (!body) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request body' });
    }

    const workflow = body.workflow;
    const workflowId = body.workflowId;
    const workflowName = body.workflowName;
    const prompt = body.prompt;
    const threadId = body.threadId;
    const messageId = body.messageId;

    if (!workflow || typeof workflow !== 'object') {
        throw createError({ statusCode: 400, statusMessage: 'Missing workflow definition' });
    }
    if (typeof workflowId !== 'string' || !workflowId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing workflowId' });
    }
    if (typeof workflowName !== 'string' || !workflowName) {
        throw createError({ statusCode: 400, statusMessage: 'Missing workflowName' });
    }
    if (typeof prompt !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'Missing prompt' });
    }
    if (typeof threadId !== 'string' || !threadId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing threadId' });
    }
    if (typeof messageId !== 'string' || !messageId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing messageId' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: session.workspace.id,
    });

    const config = useRuntimeConfig(event);
    const allowUserOverride = config.openrouterAllowUserOverride !== false;
    const requireUserKey = config.openrouterRequireUserKey === true;
    const authHeader = getHeader(event, 'authorization');
    const keyHeader = getHeader(event, 'x-or3-openrouter-key');
    const clientKey =
        (typeof keyHeader === 'string' && keyHeader.trim().length > 0
            ? keyHeader.trim()
            : undefined) ||
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);

    const apiKey = requireUserKey
        ? clientKey
        : (allowUserOverride ? clientKey : undefined) ||
          config.openrouterApiKey ||
          process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        throw createError({ statusCode: 400, statusMessage: 'Missing OpenRouter API key' });
    }

    const conversationHistory = Array.isArray(body.conversationHistory)
        ? body.conversationHistory
        : [];
    const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;

    return await startBackgroundWorkflow({
        workflow: workflow as any,
        workflowId,
        workflowName,
        prompt,
        conversationHistory: conversationHistory as Array<{ role: string; content: string }>,
        apiKey,
        userId: session.user.id,
        workspaceId: session.workspace.id,
        threadId,
        messageId,
        attachments,
    });
});
