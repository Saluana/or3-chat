/**
 * @module server/api/workflows/background.post
 *
 * Purpose:
 * Starts a background workflow execution job.
 */

import { defineEventHandler, readBody, createError, getHeader, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { startBackgroundWorkflow } from '../../utils/workflows/background-execution';
import {
    resolveCanonicalWorkflow,
    workflowsMatch,
    WorkflowCatalogError,
} from '../../utils/workflows/workflow-catalog';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import type { Attachment } from 'or3-workflow-core';

const MAX_BACKGROUND_WORKFLOW_BODY_BYTES = 256 * 1024;
const MAX_WORKFLOW_PROMPT_CHARS = 12_000;
const MAX_HISTORY_MESSAGES = 200;
const MAX_HISTORY_CONTENT_CHARS = 8_000;
const MAX_ATTACHMENTS = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function parseConversationHistory(
    value: unknown
): Array<{ role: string; content: string }> {
    if (!Array.isArray(value)) return [];
    if (value.length > MAX_HISTORY_MESSAGES) {
        throw createError({
            statusCode: 413,
            statusMessage: `conversationHistory exceeds ${MAX_HISTORY_MESSAGES} entries`,
        });
    }

    return value.map((item) => {
        const row = asRecord(item);
        if (!row) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid conversationHistory entry',
            });
        }
        if (typeof row.role !== 'string' || row.role.length === 0) {
            throw createError({
                statusCode: 400,
                statusMessage: 'conversationHistory role must be a non-empty string',
            });
        }
        if (typeof row.content !== 'string') {
            throw createError({
                statusCode: 400,
                statusMessage: 'conversationHistory content must be a string',
            });
        }
        if (row.content.length > MAX_HISTORY_CONTENT_CHARS) {
            throw createError({
                statusCode: 413,
                statusMessage: `conversationHistory content exceeds ${MAX_HISTORY_CONTENT_CHARS} chars`,
            });
        }
        return {
            role: row.role,
            content: row.content,
        };
    });
}

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const body = (await readBody(event).catch(() => null)) as
        | Record<string, unknown>
        | null;
    if (!body) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request body' });
    }
    if (
        JSON.stringify(body).length > MAX_BACKGROUND_WORKFLOW_BODY_BYTES
    ) {
        throw createError({
            statusCode: 413,
            statusMessage: `Request body exceeds ${MAX_BACKGROUND_WORKFLOW_BODY_BYTES} bytes`,
        });
    }

    const workflowId = body.workflowId;
    const workflowName = body.workflowName;
    const workflowUpdatedAt = body.workflowUpdatedAt;
    const workflowVersion = body.workflowVersion;
    const prompt = body.prompt;
    const threadId = body.threadId;
    const messageId = body.messageId;

    if (typeof workflowId !== 'string' || !workflowId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing workflowId' });
    }
    if (workflowName !== undefined && typeof workflowName !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'workflowName must be a string' });
    }
    const normalizedUpdatedAt =
        typeof workflowUpdatedAt === 'number' && Number.isFinite(workflowUpdatedAt)
            ? workflowUpdatedAt
            : undefined;
    if (workflowUpdatedAt !== undefined && normalizedUpdatedAt === undefined) {
        throw createError({ statusCode: 400, statusMessage: 'workflowUpdatedAt must be a number' });
    }
    if (workflowVersion !== undefined && typeof workflowVersion !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'workflowVersion must be a string' });
    }
    if (typeof prompt !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'Missing prompt' });
    }
    if (prompt.length > MAX_WORKFLOW_PROMPT_CHARS) {
        throw createError({
            statusCode: 413,
            statusMessage: `Prompt exceeds ${MAX_WORKFLOW_PROMPT_CHARS} chars`,
        });
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

    const rateLimitResult = checkSyncRateLimit(
        session.user.id,
        'workflow:background'
    );
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

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

    const conversationHistory = parseConversationHistory(body.conversationHistory);
    const attachments = Array.isArray(body.attachments)
        ? (body.attachments as Attachment[])
        : undefined;
    if (attachments && attachments.length > MAX_ATTACHMENTS) {
        throw createError({
            statusCode: 413,
            statusMessage: `attachments exceeds ${MAX_ATTACHMENTS} entries`,
        });
    }

    let canonicalWorkflow;
    try {
        canonicalWorkflow = await resolveCanonicalWorkflow(event, {
            workspaceId: session.workspace.id,
            workflowId,
            expectedUpdatedAt: normalizedUpdatedAt,
            expectedVersion:
                typeof workflowVersion === 'string' ? workflowVersion : undefined,
        });
    } catch (error) {
        if (error instanceof WorkflowCatalogError) {
            throw createError({
                statusCode: error.statusCode,
                statusMessage: error.message,
            });
        }
        throw error;
    }

    if (
        body.workflow !== undefined &&
        !workflowsMatch(body.workflow, canonicalWorkflow.workflow)
    ) {
        throw createError({
            statusCode: 409,
            statusMessage: 'Workflow payload mismatch with canonical server definition',
        });
    }

    const result = await startBackgroundWorkflow({
        workflow: canonicalWorkflow.workflow,
        workflowId: canonicalWorkflow.workflowId,
        workflowName: canonicalWorkflow.workflowName,
        prompt,
        conversationHistory,
        apiKey,
        userId: session.user.id,
        workspaceId: session.workspace.id,
        threadId,
        messageId,
        attachments,
    });

    recordSyncRequest(session.user.id, 'workflow:background');
    return result;
});
