/**
 * @module app/utils/chat/tools-public
 *
 * Purpose:
 * Public API for plugin developers to register and manage tools.
 */

export { useToolRegistry } from './tool-registry';
export type {
    ToolHandler,
    ExtendedToolDefinition,
    RegisteredTool,
    TypedToolDefinition,
} from './tool-registry';
export type { ToolDefinition, ToolCall, ToolExecutionContext, ToolRuntime } from './types';
import type { ToolDefinition } from './types';
import type { TypedToolDefinition } from './tool-registry';
import { validateToolDefinition } from '~~/shared/chat/tool-schema';

/**
 * `defineTool`
 *
 * Purpose:
 * Helper to define a tool with better TypeScript inference.
 *
 * @example
 * ```ts
 * const myTool = defineTool({
 *   type: 'function',
 *   function: { name, description, parameters },
 *   ui: { label, icon, defaultEnabled }
 * });
 * ```
 */
export function defineTool<T extends Record<string, unknown>>(
    def: ToolDefinition
): TypedToolDefinition<T> {
    const validation = validateToolDefinition(def);
    if (!validation.valid) throw new Error(`Invalid tool definition: ${validation.error}`);
    return def;
}
