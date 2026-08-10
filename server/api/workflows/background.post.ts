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
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import type { Attachment } from 'or3-workflow-core';
import type { ResumeFromOptions } from 'or3-workflow-core';

const MAX_BACKGROUND_WORKFLOW_BODY_BYTES = 256 * 1024;
const MAX_WORKFLOW_PROMPT_CHARS = 12_000;
const MAX_ATTACHMENTS = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function parseResumeFrom(value: unknown): ResumeFromOptions | undefined {
    if (value === undefined) return undefined;
    const resume = asRecord(value);
    if (!resume || typeof resume.startNodeId !== 'string' || !resume.startNodeId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'resumeFrom requires a startNodeId',
        });
    }
    const outputs = asRecord(resume.nodeOutputs);
    if (!outputs || Object.values(outputs).some((output) => typeof output !== 'string')) {
        throw createError({
            statusCode: 400,
            statusMessage: 'resumeFrom.nodeOutputs must be a string record',
        });
    }
    const asStringList = (field: 'executionOrder' | 'pendingNodes') => {
        const value = resume[field];
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
            throw createError({
                statusCode: 400,
                statusMessage: `resumeFrom.${field} must be a string array`,
            });
        }
        return value;
    };
    let sessionMessages: ResumeFromOptions['sessionMessages'];
    if (resume.sessionMessages !== undefined) {
        if (!Array.isArray(resume.sessionMessages)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'resumeFrom.sessionMessages must be an array',
            });
        }
        sessionMessages = resume.sessionMessages.map((message) => {
            const row = asRecord(message);
            if (
                !row ||
                !['system', 'user', 'assistant'].includes(String(row.role)) ||
                typeof row.content !== 'string'
            ) {
                throw createError({
                    statusCode: 400,
                    statusMessage:
                        'resumeFrom.sessionMessages entries must have a supported role and string content',
                });
            }
            return {
                role: row.role as 'system' | 'user' | 'assistant',
                content: row.content,
            };
        });
    }

    return {
        startNodeId: resume.startNodeId,
        nodeOutputs: outputs as Record<string, string>,
        executionOrder: asStringList('executionOrder'),
        pendingNodes: asStringList('pendingNodes'),
        sessionMessages,
        lastActiveNodeId:
            typeof resume.lastActiveNodeId === 'string'
                ? resume.lastActiveNodeId
                : undefined,
        resumeInput:
            typeof resume.resumeInput === 'string'
                ? resume.resumeInput
                : undefined,
        finalNodeId:
            typeof resume.finalNodeId === 'string'
                ? resume.finalNodeId
                : undefined,
    };
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
    const resumeFrom = parseResumeFrom(body.resumeFrom);
    const resumeStateVersion =
        typeof body.resumeStateVersion === 'number' &&
        Number.isFinite(body.resumeStateVersion) &&
        body.resumeStateVersion >= 0
            ? Math.floor(body.resumeStateVersion)
            : undefined;

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
    if (
        body.resumeStateVersion !== undefined &&
        resumeStateVersion === undefined
    ) {
        throw createError({
            statusCode: 400,
            statusMessage: 'resumeStateVersion must be a non-negative number',
        });
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
    enforceRateLimit(event, rateLimitResult);

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
    if (
        resumeFrom &&
        !canonicalWorkflow.workflow.nodes.some(
            (node) => node.id === resumeFrom.startNodeId
        )
    ) {
        throw createError({
            statusCode: 400,
            statusMessage: 'resumeFrom startNodeId is not in this workflow',
        });
    }

    const result = await startBackgroundWorkflow({
        workflow: canonicalWorkflow.workflow,
        workflowId: canonicalWorkflow.workflowId,
        workflowName: canonicalWorkflow.workflowName,
        prompt,
        apiKey,
        userId: session.user.id,
        workspaceId: session.workspace.id,
        threadId,
        messageId,
        attachments,
        resumeFrom,
        resumeStateVersion,
    });

    recordSyncRequest(session.user.id, 'workflow:background');
    return result;
});
