/**
 * @module app/utils/chat/useAi-internal/messageBuild.ts
 *
 * Purpose:
 * System prompt resolution and OpenRouter message build glue for useAi.
 *
 * Responsibilities:
 * - Resolve thread and active prompt content into a final system prompt
 * - Prepend system message to raw message history when applicable
 * - Build OpenRouter-compatible messages from model input
 * - Inject context hashes into the most recent user message
 * - Trim image payloads to safety limits
 *
 * Constraints:
 * - Must remain client safe and avoid server-only imports
 * - Image trimming and max limits must match existing behavior
 *
 * Non-Goals:
 * - Hook orchestration and filter timing
 * - Streaming and tool loop execution
 */

import { newId } from '~/db/util';
import { getThreadSystemPrompt } from '~/db/threads';
import { getPrompt } from '~/db/prompts';
import { getMaxMessageFileHashes } from '~/db/files-util';
import { promptJsonToString, composeSystemPrompt } from '~/utils/chat/prompt-utils';
import { trimOrMessagesByTokenBudget } from '~/utils/chat/messages';
import { countTokensApprox } from '~/utils/chat/tokens';
import type { ChatMessage, ContentPart } from '~/utils/chat/types';
import type { ModelInputMessage } from '../../../../types/chat-internal';
import type { OpenRouterMessage } from './types';
import { hashToContentPart } from './files';
type OpenRouterBuildModule = typeof import('~/core/auth/openrouter-build');

let openRouterBuildModulePromise: Promise<OpenRouterBuildModule> | null = null;

async function getOpenRouterBuildModule(): Promise<OpenRouterBuildModule> {
    if (!openRouterBuildModulePromise) {
        openRouterBuildModulePromise = import('~/core/auth/openrouter-build');
    }
    return openRouterBuildModulePromise;
}

/**
 * `ResolveSystemPromptParams`
 *
 * Purpose:
 * Parameters for resolving the effective system prompt text.
 */
export type ResolveSystemPromptParams = {
    threadId: string | null | undefined;
    activePromptContent: unknown | null | undefined;
};

/**
 * `resolveSystemPromptText`
 *
 * Purpose:
 * Resolves thread-specific system prompt text with fallback to active prompt.
 */
export async function resolveSystemPromptText(
    params: ResolveSystemPromptParams
): Promise<string | null> {
    if (!params.threadId) return null;
    try {
        const promptId = await getThreadSystemPrompt(params.threadId);
        if (promptId) {
            const prompt = await getPrompt(promptId);
            if (prompt) return promptJsonToString(prompt.content);
        }
    } catch (e) {
        console.warn('Failed to load thread system prompt', e);
    }
    return params.activePromptContent
        ? promptJsonToString(
              params.activePromptContent as Parameters<
                  typeof promptJsonToString
              >[0]
          )
        : null;
}

/**
 * `BuildSystemPromptParams`
 *
 * Purpose:
 * Parameters for building the final system prompt message.
 */
export type BuildSystemPromptParams = ResolveSystemPromptParams & {
    masterPrompt?: string;
};

/**
 * `buildSystemPromptMessage`
 *
 * Purpose:
 * Builds a system message suitable for the chat history.
 */
export async function buildSystemPromptMessage(
    params: BuildSystemPromptParams
): Promise<ChatMessage | null> {
    const threadSystemText = await resolveSystemPromptText(params);
    let finalSystem: string | null = null;
    try {
        finalSystem = composeSystemPrompt(
            params.masterPrompt ?? '',
            threadSystemText || null
        );
    } catch {
        finalSystem = (threadSystemText || '').trim() || null;
    }
    if (!finalSystem || !finalSystem.trim()) return null;
    return {
        role: 'system',
        content: finalSystem,
        id: `system-${newId()}`,
    };
}

/**
 * `BuildOpenRouterMessagesParams`
 *
 * Purpose:
 * Parameters for building OpenRouter-compatible messages for send.
 */
export type BuildOpenRouterMessagesParams = {
    effectiveMessages: ChatMessage[];
    assistantHashes: string[];
    prevAssistantId?: string | null;
    contextHashes?: string[] | null;
    fileHashes?: string[] | null;
    maxImageInputs?: number;
    imageInclusionPolicy?:
        | 'all'
        | 'recent'
        | 'recent-user'
        | 'recent-assistant';
    /**
     * Approximate input-token budget. When set, oldest non-system/non-user
     * messages are dropped until the remaining text fits. The system message
     * and last user message are always kept.
     */
    maxInputTokens?: number;
};

/**
 * Applies the final text/tool token budget to a provider-ready message list.
 * Call this after request hooks so extensions cannot accidentally push the
 * payload back over the selected model's context allowance.
 */
export async function enforceOpenRouterMessageTokenBudget(
    messages: OpenRouterMessage[],
    maxInputTokens: number
): Promise<OpenRouterMessage[]> {
    if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) {
        return messages;
    }
    return trimOrMessagesByTokenBudget(
        messages,
        maxInputTokens,
        countTokensApprox
    );
}

/**
 * `buildOpenRouterMessagesForSend`
 *
 * Purpose:
 * Builds OpenRouter-compatible messages, injecting context hashes when needed.
 */
export async function buildOpenRouterMessagesForSend(
    params: BuildOpenRouterMessagesParams
): Promise<OpenRouterMessage[]> {
    const modelInputMessages: ModelInputMessage[] = params.effectiveMessages
        .map(
            (m): ModelInputMessage => ({
                role: m.role,
                content: m.content,
                id: m.id,
                file_hashes: m.file_hashes,
                name:
                    m.name ??
                    (typeof m.data?.tool_name === 'string'
                        ? m.data.tool_name
                        : undefined),
                tool_call_id:
                    m.tool_call_id ??
                    (typeof m.data?.tool_call_id === 'string'
                        ? m.data.tool_call_id
                        : undefined),
                tool_calls:
                    m.tool_calls ??
                    (Array.isArray(m.data?.tool_calls)
                        ? (m.data.tool_calls as ModelInputMessage['tool_calls'])
                        : undefined),
            })
        );

    let lastUserIdx = -1;
    for (let i = modelInputMessages.length - 1; i >= 0; i -= 1) {
        if (modelInputMessages[i]?.role === 'user') {
            lastUserIdx = i;
            break;
        }
    }

    if (params.assistantHashes.length && params.prevAssistantId) {
        const target = modelInputMessages.find(
            (m) => m.id === params.prevAssistantId
        );
        if (target) target.file_hashes = null;
    }

    const maxMessageFileHashes = getMaxMessageFileHashes();
    const contextHashesList = Array.isArray(params.contextHashes)
        ? params.contextHashes.slice(0, maxMessageFileHashes)
        : [];
    if (contextHashesList.length && lastUserIdx >= 0) {
        const seenContext = new Set<string>([
            ...(Array.isArray(params.fileHashes) ? params.fileHashes : []),
        ]);
        const uniqueContextHashes: string[] = [];
        for (const hash of contextHashesList) {
            if (!hash || seenContext.has(hash)) continue;
            seenContext.add(hash);
            uniqueContextHashes.push(hash);
            if (uniqueContextHashes.length >= maxMessageFileHashes) break;
        }

        const resolvedContextParts = await Promise.all(
            uniqueContextHashes.map((hash) => hashToContentPart(hash))
        );
        const contextParts: ContentPart[] = resolvedContextParts.filter(
            (part): part is ContentPart => part !== null
        );

        if (contextParts.length) {
            const target = modelInputMessages[lastUserIdx];
            if (target) {
                if (!Array.isArray(target.content)) {
                    if (typeof target.content === 'string') {
                        target.content = [
                            { type: 'text', text: target.content },
                        ];
                    } else {
                        target.content = [];
                    }
                }
                target.content.push(...contextParts);
            }
        }
    }

    const { buildOpenRouterMessages } = await getOpenRouterBuildModule();
    let orMessages: OpenRouterMessage[] = await buildOpenRouterMessages(
        modelInputMessages,
        {
            maxImageInputs: params.maxImageInputs ?? 5,
            imageInclusionPolicy: params.imageInclusionPolicy ?? 'all',
            debug: false,
        }
    );

    if (params.maxInputTokens && params.maxInputTokens > 0) {
        orMessages = await enforceOpenRouterMessageTokenBudget(
            orMessages,
            params.maxInputTokens
        );
    }

    return orMessages;
}
