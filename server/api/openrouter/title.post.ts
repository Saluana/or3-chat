import { z } from 'zod';
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { checkAndRecordLlmRequest } from '../../utils/llm/rate-limiter';
import { generateTitle } from '../../utils/titles/generate';
import { readFastModel } from '../../utils/ai/fast-model';
import { resolveChatCredential } from '../../utils/ai/chat-router';
import { TitleRequestSchema } from '~~/shared/titles/title';
import { DEFAULT_FAST_MODEL, FastModelSchema } from '~~/shared/ai/fast-model';
import { isOpenAiModel } from '~~/shared/openai/models';

const BodySchema = TitleRequestSchema.extend({
    workspaceId: z.string().min(1).max(200),
    model: FastModelSchema.optional(),
}).strict();

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    requireCloudMutation(event);
    const cloud = isSsrAuthEnabled(event);
    const session = await resolveSessionContext(event);
    if (cloud) requireCan(session, 'workspace.write', session.workspace ? { kind: 'workspace', id: session.workspace.id } : undefined);
    const body = BodySchema.safeParse(await readLimitedJsonBody(event, 16 * 1024));
    if (!body.success) throw createError({ statusCode: 400 });
    if (cloud && (!session.authenticated || !session.user?.id || session.workspace?.id !== body.data.workspaceId))
        throw createError({ statusCode: 403 });
    // Cloud settings are authoritative; client model overrides are never used there.
    const model = cloud ? await readFastModel(event, body.data.workspaceId) : body.data.model ?? DEFAULT_FAST_MODEL;
    // The fast model's router owns the credential.
    const { apiKey } = await resolveChatCredential(event, model, session);
    if (!apiKey) throw createError({ statusCode: 400, statusMessage: `${isOpenAiModel(model) ? 'OpenAI' : 'OpenRouter'} credentials unavailable.` });
    const rate = checkAndRecordLlmRequest(`titles:${session.user?.id ?? event.node.req.socket.remoteAddress}`, { windowMs: 60000, maxRequests: 30 });
    if (!rate.allowed) {
        setResponseHeader(event, 'Retry-After', Math.ceil((rate.retryAfterMs ?? 1000) / 1000));
        throw createError({ statusCode: 429 });
    }
    const started = Date.now();
    try {
        const title = await generateTitle(event, body.data, model, apiKey);
        console.info('[titles]', { type: body.data.type, outcome: 'generated', durationMs: Date.now() - started });
        return { title };
    } catch {
        console.info('[titles]', { type: body.data.type, outcome: 'failed', durationMs: Date.now() - started });
        throw createError({ statusCode: 502, statusMessage: 'Title generation unavailable.' });
    }
});
