import { HISTORY_TOOL_NAMES } from '~~/shared/chat/history-tools';
import type { ToolDefinition } from './types';

/** Decide placement before freezing the generation's admitted tool catalog. */
export async function placeHistoryTools(definitions: readonly ToolDefinition[], options: { background: boolean; threadId?: string; signal: AbortSignal }): Promise<ToolDefinition[]> {
    const history = new Set<string>(HISTORY_TOOL_NAMES);
    const source = structuredClone([...definitions]);
    if (!options.background || !options.threadId || !source.some((tool) => history.has(tool.function.name))) return source;
    let ready = false;
    try {
        const result = await $fetch<{ ready: boolean }>('/api/chat/history-readiness', { query: { thread_id: options.threadId }, signal: options.signal });
        ready = result.ready === true;
    } catch (error) { if (options.signal.aborted) throw error; }
    options.signal.throwIfAborted();
    return source.map((tool) => history.has(tool.function.name) ? { ...tool, runtime: ready ? 'hybrid' as const : 'client' as const } : tool);
}
