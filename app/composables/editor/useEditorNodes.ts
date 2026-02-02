import { reactive } from 'vue';
import type { Node, Mark, Extension } from '@tiptap/core';
import type { LazyEditorExtensionFactory } from './useEditorExtensionLoader';

/**
 * @module app/composables/editor/useEditorNodes
 *
 * Purpose:
 * Provide registries for editor nodes, marks, and extensions so plugins can
 * extend the TipTap editor without touching core code.
 *
 * Responsibilities:
 * - Store node, mark, and extension descriptors in global registries
 * - Maintain reactive lists for computed consumers
 * - Offer registration, unregistration, and listing helpers
 *
 * Non-responsibilities:
 * - Loading or resolving lazy extension factories
 * - Enforcing registry uniqueness beyond id replacement
 * - Rendering editor UI components
 */

/**
 * Definition for an extendable editor node extension.
 *
 * Purpose:
 * Describe a TipTap node extension that can be registered by plugins.
 *
 * Behavior:
 * Registered nodes are stored in a global registry and surfaced in order.
 *
 * Constraints:
 * - `id` must be stable across reloads
 * - Ordering defaults to 200 when unspecified
 *
 * Non-Goals:
 * - Enforcing uniqueness across plugins
 * - Validating node schema details
 */
export interface EditorNode {
    /** Unique id (stable across reloads). */
    id: string;
    /** TipTap Node extension instance. */
    extension: Node;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
}

/**
 * Definition for an extendable editor mark extension.
 *
 * Purpose:
 * Describe a TipTap mark extension that can be registered by plugins.
 *
 * Behavior:
 * Registered marks are stored in a global registry and surfaced in order.
 *
 * Constraints:
 * - `id` must be stable across reloads
 * - Ordering defaults to 200 when unspecified
 *
 * Non-Goals:
 * - Enforcing uniqueness across plugins
 * - Validating mark schema details
 */
export interface EditorMark {
    /** Unique id (stable across reloads). */
    id: string;
    /** TipTap Mark extension instance. */
    extension: Mark;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
}

/**
 * Definition for an extendable editor generic extension.
 *
 * Purpose:
 * Describe a TipTap extension that can be registered by plugins.
 *
 * Behavior:
 * Registered extensions are stored in a global registry and surfaced in order.
 *
 * Constraints:
 * - `id` must be stable across reloads
 * - Ordering defaults to 200 when unspecified
 *
 * Non-Goals:
 * - Enforcing uniqueness across plugins
 * - Resolving lazy factories
 */
export interface EditorExtension {
    /** Unique id (stable across reloads). */
    id: string;
    /** TipTap Extension instance. */
    extension?: Extension;
    /** Optional lazy factory to create the extension without pulling TipTap into entry. */
    factory?: LazyEditorExtensionFactory;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
}

// Global singleton registries (survive HMR) stored on globalThis to avoid duplication.
type EditorRegistryGlobals = typeof globalThis & {
    __or3EditorNodesRegistry?: Map<string, EditorNode>;
    __or3EditorMarksRegistry?: Map<string, EditorMark>;
    __or3EditorExtensionsRegistry?: Map<string, EditorExtension>;
};
const g = globalThis as EditorRegistryGlobals;

const nodesRegistry: Map<string, EditorNode> =
    g.__or3EditorNodesRegistry ?? (g.__or3EditorNodesRegistry = new Map<string, EditorNode>());

const marksRegistry: Map<string, EditorMark> =
    g.__or3EditorMarksRegistry ?? (g.__or3EditorMarksRegistry = new Map<string, EditorMark>());

const extensionsRegistry: Map<string, EditorExtension> =
    g.__or3EditorExtensionsRegistry ??
    (g.__or3EditorExtensionsRegistry = new Map<string, EditorExtension>());

// Reactive wrapper lists we maintain for computed filtering (Map itself not reactive).
const nodesReactiveList = reactive<{ items: EditorNode[] }>({ items: [] });
const marksReactiveList = reactive<{ items: EditorMark[] }>({ items: [] });
const extensionsReactiveList = reactive<{ items: EditorExtension[] }>({
    items: [],
});

function syncNodesReactiveList() {
    nodesReactiveList.items = Array.from(nodesRegistry.values());
}

function syncMarksReactiveList() {
    marksReactiveList.items = Array.from(marksRegistry.values());
}

function syncExtensionsReactiveList() {
    extensionsReactiveList.items = Array.from(extensionsRegistry.values());
}

/**
 * Register or replace an editor node extension.
 *
 * Purpose:
 * Allow plugins to contribute node extensions to the editor registry.
 *
 * Behavior:
 * Inserts or replaces the node by `id` and updates the reactive list.
 *
 * Constraints:
 * - Designed for client usage where HMR can re-register nodes
 *
 * Non-Goals:
 * - Deduplicating nodes across plugin boundaries
 */
export function registerEditorNode(node: EditorNode) {
    if (import.meta.dev && nodesRegistry.has(node.id)) {
        console.warn(`[useEditorNodes] Overwriting existing node: ${node.id}`);
    }
    nodesRegistry.set(node.id, node);
    syncNodesReactiveList();
}

/**
 * Unregister a node extension by id.
 *
 * Purpose:
 * Remove a previously registered node from the registry.
 *
 * Behavior:
 * Deletes the node and updates the reactive list if it existed.
 *
 * Constraints:
 * - No effect if the id is not present
 *
 * Non-Goals:
 * - Cleaning up related editor state or UI
 */
export function unregisterEditorNode(id: string) {
    if (nodesRegistry.delete(id)) syncNodesReactiveList();
}

/**
 * Register or replace an editor mark extension.
 *
 * Purpose:
 * Allow plugins to contribute mark extensions to the editor registry.
 *
 * Behavior:
 * Inserts or replaces the mark by `id` and updates the reactive list.
 *
 * Constraints:
 * - Designed for client usage where HMR can re-register marks
 *
 * Non-Goals:
 * - Deduplicating marks across plugin boundaries
 */
export function registerEditorMark(mark: EditorMark) {
    if (import.meta.dev && marksRegistry.has(mark.id)) {
        console.warn(`[useEditorNodes] Overwriting existing mark: ${mark.id}`);
    }
    marksRegistry.set(mark.id, mark);
    syncMarksReactiveList();
}

/**
 * Unregister a mark extension by id.
 *
 * Purpose:
 * Remove a previously registered mark from the registry.
 *
 * Behavior:
 * Deletes the mark and updates the reactive list if it existed.
 *
 * Constraints:
 * - No effect if the id is not present
 *
 * Non-Goals:
 * - Cleaning up related editor state or UI
 */
export function unregisterEditorMark(id: string) {
    if (marksRegistry.delete(id)) syncMarksReactiveList();
}

/**
 * Register or replace an editor generic extension.
 *
 * Purpose:
 * Allow plugins to contribute generic extensions to the editor registry.
 *
 * Behavior:
 * Inserts or replaces the extension by `id` and updates the reactive list.
 *
 * Constraints:
 * - Designed for client usage where HMR can re-register extensions
 *
 * Non-Goals:
 * - Deduplicating extensions across plugin boundaries
 */
export function registerEditorExtension(extension: EditorExtension) {
    if (import.meta.dev && extensionsRegistry.has(extension.id)) {
        console.warn(
            `[useEditorNodes] Overwriting existing extension: ${extension.id}`
        );
    }
    extensionsRegistry.set(extension.id, extension);
    syncExtensionsReactiveList();
}

/**
 * Unregister a generic extension by id.
 *
 * Purpose:
 * Remove a previously registered extension from the registry.
 *
 * Behavior:
 * Deletes the extension and updates the reactive list if it existed.
 *
 * Constraints:
 * - No effect if the id is not present
 *
 * Non-Goals:
 * - Cleaning up related editor state or UI
 */
export function unregisterEditorExtension(id: string) {
    if (extensionsRegistry.delete(id)) syncExtensionsReactiveList();
}

/**
 * List all registered node extensions in display order.
 *
 * Purpose:
 * Provide a stable ordering for node extensions in the editor pipeline.
 *
 * Behavior:
 * Sorts by `order` then by `id` for deterministic results.
 *
 * Constraints:
 * - Mutates the returned array via in-place sort
 *
 * Non-Goals:
 * - Returning a defensive copy
 */
export function listEditorNodes(): EditorNode[] {
    return nodesReactiveList.items.sort((a, b) => {
        const orderDiff = (a.order ?? 200) - (b.order ?? 200);
        // Stable sort: tie-break by id
        return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
    });
}

/**
 * List all registered mark extensions in display order.
 *
 * Purpose:
 * Provide a stable ordering for mark extensions in the editor pipeline.
 *
 * Behavior:
 * Sorts by `order` then by `id` for deterministic results.
 *
 * Constraints:
 * - Mutates the returned array via in-place sort
 *
 * Non-Goals:
 * - Returning a defensive copy
 */
export function listEditorMarks(): EditorMark[] {
    return marksReactiveList.items.sort((a, b) => {
        const orderDiff = (a.order ?? 200) - (b.order ?? 200);
        // Stable sort: tie-break by id
        return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
    });
}

/**
 * List all registered generic extensions in display order.
 *
 * Purpose:
 * Provide a stable ordering for generic extensions in the editor pipeline.
 *
 * Behavior:
 * Sorts by `order` then by `id` for deterministic results.
 *
 * Constraints:
 * - Mutates the returned array via in-place sort
 *
 * Non-Goals:
 * - Returning a defensive copy
 */
export function listEditorExtensions(): EditorExtension[] {
    return extensionsReactiveList.items.sort((a, b) => {
        const orderDiff = (a.order ?? 200) - (b.order ?? 200);
        // Stable sort: tie-break by id
        return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
    });
}

/**
 * Convenience helper for plugin authors to check existing node ids.
 *
 * Purpose:
 * Allow plugins to avoid id collisions when registering nodes.
 *
 * Behavior:
 * Returns the current registry keys.
 *
 * Constraints:
 * - Snapshot reflects current state at call time
 *
 * Non-Goals:
 * - Providing reactive updates
 */
export function listRegisteredEditorNodeIds(): string[] {
    return Array.from(nodesRegistry.keys());
}

/**
 * Convenience helper for plugin authors to check existing mark ids.
 *
 * Purpose:
 * Allow plugins to avoid id collisions when registering marks.
 *
 * Behavior:
 * Returns the current registry keys.
 *
 * Constraints:
 * - Snapshot reflects current state at call time
 *
 * Non-Goals:
 * - Providing reactive updates
 */
export function listRegisteredEditorMarkIds(): string[] {
    return Array.from(marksRegistry.keys());
}

/**
 * Convenience helper for plugin authors to check existing extension ids.
 *
 * Purpose:
 * Allow plugins to avoid id collisions when registering extensions.
 *
 * Behavior:
 * Returns the current registry keys.
 *
 * Constraints:
 * - Snapshot reflects current state at call time
 *
 * Non-Goals:
 * - Providing reactive updates
 */
export function listRegisteredEditorExtensionIds(): string[] {
    return Array.from(extensionsRegistry.keys());
}

// Note: Core (built-in) extensions remain hard-coded in DocumentEditor.vue;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
