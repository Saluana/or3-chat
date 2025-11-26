/**
 * Public API for plugin developers to register and manage tools.
 * This module re-exports the registry composable and types for easy access.
 */

export { useToolRegistry } from './tool-registry';
export type {
    ToolHandler,
    ExtendedToolDefinition,
    RegisteredTool,
} from './tool-registry';
export type { ToolDefinition, ToolCall } from './types';

/**
 * Helper to define a tool with better TypeScript inference.
 * Usage:
 *   const myTool = defineTool({
 *     type: 'function',
 *     function: { name, description, parameters },
 *     ui: { label, icon, defaultEnabled }
 *   });
 */
export function defineTool<T extends Record<string, unknown>>(
    def: T
): T {
    return def;
}
