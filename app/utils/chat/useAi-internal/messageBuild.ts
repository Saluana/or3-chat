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
import { MAX_MESSAGE_FILE_HASHES } from '~/db/files-util';
import { promptJsonToString, composeSystemPrompt } from '~/utils/chat/prompt-utils';
import { trimOrMessagesImages } from '~/utils/chat/messages';
import type { ChatMessage, ContentPart } from '~/utils/chat/types';
import type { ModelInputMessage } from '../../../../types/chat-internal';
import type { OpenRouterMessage } from './types';
import { hashToContentPart } from './files';

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
};

/**
 * `buildOpenRouterMessagesForSend`
 *
 * Purpose:
 * Builds OpenRouter-compatible messages, injecting context hashes when needed.
 */
export async function buildOpenRouterMessagesForSend(
    params: BuildOpenRouterMessagesParams
): Promise<OpenRouterMessage[]> {
    const isModelMessage = (
        m: ChatMessage
    ): m is ChatMessage & { role: 'user' | 'assistant' | 'system' } =>
        m.role !== 'tool';

    const modelInputMessages: ModelInputMessage[] = params.effectiveMessages
        .filter(isModelMessage)
        .map(
            (m): ModelInputMessage => ({
                role: m.role,
                content: m.content,
                id: m.id,
                file_hashes: m.file_hashes,
                name: m.name,
                tool_call_id: m.tool_call_id,
            })
        );

    if (params.assistantHashes.length && params.prevAssistantId) {
        const target = modelInputMessages.find(
            (m) => m.id === params.prevAssistantId
        );
        if (target) target.file_hashes = null;
    }

    const contextHashesList = Array.isArray(params.contextHashes)
        ? params.contextHashes.slice(0, MAX_MESSAGE_FILE_HASHES)
        : [];
    if (contextHashesList.length) {
        const seenContext = new Set<string>(
            Array.isArray(params.fileHashes) ? params.fileHashes : []
        );
        const contextParts: ContentPart[] = [];
        for (const h of contextHashesList) {
            if (!h || seenContext.has(h)) continue;
            if (contextParts.length >= MAX_MESSAGE_FILE_HASHES) break;
            const part = await hashToContentPart(h);
            if (part) {
                contextParts.push(part);
                seenContext.add(h);
            }
        }
        if (contextParts.length) {
            const lastUserIdx = [...modelInputMessages]
                .map((m, idx: number) => (m.role === 'user' ? idx : -1))
                .filter((idx) => idx >= 0)
                .pop();
            if (lastUserIdx != null && lastUserIdx >= 0) {
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
    }

    const { buildOpenRouterMessages } = await import(
        '~/core/auth/openrouter-build'
    );
    const orMessages: OpenRouterMessage[] = await buildOpenRouterMessages(
        modelInputMessages,
        {
            maxImageInputs: params.maxImageInputs ?? 16,
            imageInclusionPolicy: params.imageInclusionPolicy ?? 'all',
            debug: false,
        }
    );

    trimOrMessagesImages(
        orMessages as Parameters<typeof trimOrMessagesImages>[0],
        5
    );

    return orMessages;
}
