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
} from './tool-registry';
export type { ToolDefinition, ToolCall, ToolRuntime } from './types';

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
    def: T
): T {
    return def;
}
