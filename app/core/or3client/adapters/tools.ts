/**
 * Tools Adapter
 *
 * Wraps the AI tool registry service.
 * Preserves localStorage persistence, validation, and timeout execution.
 */

import { useToolRegistry } from '~/utils/chat/tool-registry';
import { clientOnlyServiceAdapter } from '../utils';
import type { ToolsAdapter } from '../client';

/**
 * Creates the tools adapter.
 * Wrapped for SSR safety (localStorage usage).
 */
function createToolsAdapterImpl(): ToolsAdapter {
    return {
        use: useToolRegistry,
    };
}

// SSR fallback returns a no-op registry
function createToolsFallback() {
    return {
        registerTool: () => ({ definition: {}, handler: () => '', enabled: { value: false }, lastError: { value: null } }),
        unregisterTool: () => {},
        getTool: () => undefined,
        setEnabled: () => {},
        hydrate: () => {},
        getEnabledDefinitions: () => [],
        executeTool: async () => ({ result: null, toolName: '', timedOut: false }),
        tools: new Map(),
        listTools: () => [],
    };
}

/**
 * SSR-safe tools adapter factory.
 */
export function createToolsAdapter(): ToolsAdapter {
    return clientOnlyServiceAdapter(createToolsAdapterImpl, createToolsFallback as any);
}
