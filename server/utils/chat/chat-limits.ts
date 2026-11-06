import type { H3Event } from 'h3';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { CHAT_LIMITS_KEY, ChatLimitsSchema, DEFAULT_CHAT_LIMITS, effectiveChatLimits, type ChatLimits } from '~~/shared/chat/chat-limits';

export function instanceChatLimits(event: H3Event): ChatLimits {
    // Keep defaults for older or partial runtime configuration.
    const config: { chatToolIterations?: number; chatGeneratedImages?: number } = useRuntimeConfig(event).public;
    return ChatLimitsSchema.parse({ toolIterations: config.chatToolIterations ?? DEFAULT_CHAT_LIMITS.toolIterations,
        generatedImages: config.chatGeneratedImages ?? DEFAULT_CHAT_LIMITS.generatedImages });
}

export async function readChatLimits(event: H3Event, workspaceId: string) {
    const instance = instanceChatLimits(event);
    const raw = await getWorkspaceSettingsStore(event).get(workspaceId, CHAT_LIMITS_KEY);
    let workspace: ChatLimits | null = null;
    if (raw) {
        try { const parsed = ChatLimitsSchema.safeParse(JSON.parse(raw)); if (parsed.success) workspace = parsed.data; }
        catch { /* Invalid saved workspace settings do not override the instance limit. */ }
    }
    return { instance, workspace, effective: effectiveChatLimits(instance, workspace) };
}
