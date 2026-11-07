import { ChatLimitsSchema, type ChatLimits } from '~~/shared/chat/chat-limits';

const FRESH_MS = 60_000;
const cache = new Map<string, { limits: ChatLimits; fetchedAt: number }>();

/**
 * Workspace limits bound the client-driven tool loop and saved images. A short
 * per-workspace cache keeps this lookup off most sends, and a transient failure
 * reuses the limits this workspace last returned rather than failing a turn
 * that is already saved. With nothing known yet, the failure still surfaces.
 */
export async function resolveWorkspaceChatLimits(
    workspaceId: string,
    load: (signal?: AbortSignal) => Promise<unknown>,
    signal?: AbortSignal,
): Promise<ChatLimits> {
    const cached = cache.get(workspaceId);
    if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached.limits;
    try {
        const limits = ChatLimitsSchema.parse(await load(signal));
        cache.set(workspaceId, { limits, fetchedAt: Date.now() });
        return limits;
    } catch (error) {
        // Stop must stay a cancellation, never a fallback or a failed turn.
        signal?.throwIfAborted();
        if (!cached) throw error;
        return cached.limits;
    }
}

/** Test and teardown seam. */
export function clearWorkspaceChatLimitsCache(): void {
    cache.clear();
}
