import { z } from 'zod';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';
import { DelegationModelSelectionError, selectDelegationModel, resolveDelegationModel } from '~~/shared/openrouter/delegation-model-catalog';
import { OPENROUTER_MODEL_VARIANTS } from '~~/shared/openrouter/model-variants';
import { OPENROUTER_REASONING_EFFORTS } from '~~/shared/openrouter/reasoning';
import { getAnthropicPromptCacheControl } from '~~/shared/openrouter/request';
import { DELEGATE_CHAT_TIMEOUT_MS, DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { DelegationDefaultsSchema, DelegationWaitSchema } from '~~/shared/chat/delegation-checkpoint';
import { delegationAdmissionFingerprint } from '~~/shared/chat/delegation-identities';
import { toolCallFingerprint } from '~~/shared/chat/tool-ledger';
import { ChatContextAdmissionError } from '~~/shared/chat/context-budget';
import { assertUtf8Limit, MAX_TOOL_ARGUMENT_BYTES } from '~~/shared/chat/tool-limits';
import { validateToolDefinitions } from '~~/shared/chat/tool-schema';
import { admitServerProviderBody, contextPolicyFromCatalog, withoutOr3RequestMetadata } from '../chat/context-admission';
import { prepareNewDelegationChild } from './delegation-child';
import { getChatJobExecution, type BackgroundJob } from './types';

const task = z.object({
    task: z.string().trim().min(1).max(20_000),
    model: z.string().trim().min(1).max(200).optional(),
    variant: z.enum(OPENROUTER_MODEL_VARIANTS).optional(),
    reasoningEffort: z.enum(OPENROUTER_REASONING_EFFORTS).optional(),
}).strict();
const batch = z.object({ tasks: z.array(z.unknown()).min(1).max(4) }).strict();

/** Explicitly safe messages about unsupported delegation requests. */
export class DelegationPreparationError extends Error {}

/** Prepare a bounded wait without creating a child or making a model request. */
export async function prepareDelegationWait(parent: BackgroundJob, input: {
    callId: string; argumentsJson: string; apiKey: string; serverURL?: string; signal?: AbortSignal;
}) {
    assertUtf8Limit(input.argumentsJson, MAX_TOOL_ARGUMENT_BYTES, 'Tool arguments');
    let args: unknown;
    try { args = JSON.parse(input.argumentsJson); } catch { throw new DelegationPreparationError('Invalid delegation arguments.'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new DelegationPreparationError('Invalid delegation arguments.');
    if ('threadId' in args) throw new DelegationPreparationError('Continuing an existing chat is unavailable for durable delegation.');
    const parsedBatch = batch.safeParse(args);
    const parsedSingle = task.safeParse(args);
    if (!parsedBatch.success && !parsedSingle.success) throw new DelegationPreparationError('Invalid delegation arguments.');
    const tasks = parsedBatch.success ? parsedBatch.data.tasks : [parsedSingle.data!];
    const execution = getChatJobExecution(parent);
    if (!execution || execution.delegationRecoveryPolicy !== 'v1' || !parent.generationId || !parent.syncProviderId)
        throw new DelegationPreparationError('Durable delegation is unavailable.');
    const defaults = DelegationDefaultsSchema.parse(execution.delegationDefaults);
    const parentBody = execution.body;
    const parentContext = parentBody._context;
    if (!parentContext || typeof parentContext !== 'object' || Array.isArray(parentContext) ||
        (parentContext as Record<string, unknown>).version !== 1)
        throw new DelegationPreparationError('Delegation context settings are unavailable.');
    const parentTools = validateToolDefinitions(parentBody.tools ?? []);
    if (!parentTools.valid) throw new DelegationPreparationError('Invalid parent tool admission.');
    const hints = parentBody._toolRuntime;
    if (hints !== undefined && (!hints || typeof hints !== 'object' || Array.isArray(hints)))
        throw new DelegationPreparationError('Invalid parent tool runtime.');
    const runtimes = (hints ?? {}) as Record<string, unknown>;
    const tools = parentTools.value.filter(tool => tool.function.name !== DELEGATE_CHAT_TOOL);
    if (tools.some(tool => runtimes[tool.function.name] === 'client'))
        throw new DelegationPreparationError('A browser-only tool prevents durable delegation.');
    const createdAt = Date.now();
    let catalog;
    try {
        catalog = await fetchOpenRouterCatalog(createOpenRouterClient({ apiKey: input.apiKey, serverURL: input.serverURL }), input.signal,
            { deadlineMs: 15_000 });
    } catch (error) {
        if (input.signal?.aborted) throw error;
        throw new DelegationPreparationError('The model catalog is unavailable.');
    }
    input.signal?.throwIfAborted();
    const parentReasoning = parentBody.reasoning && typeof parentBody.reasoning === 'object' && !Array.isArray(parentBody.reasoning)
        ? parentBody.reasoning as Record<string, unknown> : undefined;
    const parentModel = { model: typeof parentBody.model === 'string' ? parentBody.model : '',
        thinking: !!parentReasoning, reasoningEffort: typeof parentReasoning?.effort === 'string' ? parentReasoning.effort : null };
    const children: Array<z.infer<typeof DelegationWaitSchema>['children'][number]> = [];
    for (const [index, raw] of tasks.entries()) {
        input.signal?.throwIfAborted();
        const parsedTask = task.safeParse(raw);
        if (!parsedTask.success) {
            children.push({ kind: 'rejected', index, settlement: { kind: 'unavailable', code: 'Invalid delegated task.' } });
            continue;
        }
        const item = parsedTask.data;
        try {
            const selected = selectDelegationModel(catalog, item.model ?? '', item.reasoningEffort, parentModel, item.variant);
            const model = resolveDelegationModel(catalog, selected.model);
            if (!model.architecture?.input_modalities?.includes('text') ||
                !model.architecture.output_modalities?.includes('text') ||
                model.architecture.output_modalities.some(modality => modality !== 'text'))
                throw new DelegationPreparationError('The selected model is not a verified text-only model.');
            if (tools.length && model.supported_parameters && !model.supported_parameters.includes('tools'))
                throw new DelegationPreparationError('The selected model does not support the enabled tools.');
            const body: Record<string, unknown> = { model: selected.model,
                messages: [...defaults.instructions, { role: 'user', content: item.task }], stream: true, modalities: ['text'],
                _context: { version: 1, user_max_context_tokens: (parentContext as Record<string, unknown>).user_max_context_tokens,
                    requested_completion_tokens: null } };
            if (selected.reasoning) body.reasoning = selected.reasoning;
            const cacheControl = getAnthropicPromptCacheControl(selected.model);
            if (cacheControl) body.cache_control = cacheControl;
            if (tools.length) {
                body.tools = tools;
                body.tool_choice = 'auto';
                body._toolRuntime = Object.fromEntries(tools.map(tool => [tool.function.name, runtimes[tool.function.name] ?? 'server']));
            }
            const policy = contextPolicyFromCatalog(body, catalog);
            const admittedBody = await admitServerProviderBody(withoutOr3RequestMetadata(body), policy, input.signal);
            const childBody = { ...body, ...admittedBody };
            const child = prepareNewDelegationChild(parent, { callId: input.callId, index, task: item.task, body: childBody, createdAt });
            const childExecution = child.execution;
            if (!childExecution || !('history' in childExecution) || !childExecution.history) throw new Error('Invalid child history.');
            const history = childExecution.history;
            if (history.kind !== 'new-turn' || !history.userMessage) throw new Error('Invalid child history.');
            children.push({ kind: 'prepared', index, admissionId: history.admissionId, threadId: child.threadId,
                userMessageId: history.userMessage.id, assistantMessageId: child.messageId,
                admissionFingerprint: delegationAdmissionFingerprint(child),
                admission: { body: JSON.parse(JSON.stringify(childBody)), history: JSON.parse(JSON.stringify(history)) },
                request: { task: item.task, model: selected.model, ...(item.variant ? { variant: item.variant } : {}),
                    ...(item.reasoningEffort ? { reasoningEffort: item.reasoningEffort } : {}) } });
        } catch (error) {
            if (input.signal?.aborted) throw error;
            const message = error instanceof DelegationPreparationError || error instanceof DelegationModelSelectionError ||
                error instanceof ChatContextAdmissionError
                ? error.message : 'Delegated chat is unavailable.';
            children.push({ kind: 'rejected', index, settlement: { kind: 'unavailable', code: message.slice(0, 200) || 'Delegated chat is unavailable.' } });
        }
    }
    return DelegationWaitSchema.parse({ version: 1, revision: 0, callId: input.callId,
        argumentFingerprint: toolCallFingerprint(DELEGATE_CHAT_TOOL, input.argumentsJson),
        deadlineAt: createdAt + DELEGATE_CHAT_TIMEOUT_MS, nextCheckAt: createdAt, children });
}
