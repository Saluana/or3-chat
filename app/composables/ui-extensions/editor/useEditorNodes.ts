import { reactive } from 'vue';
import type { Extension } from '@tiptap/core';

/** Definition for an extendable editor node extension. */
export interface EditorNode {
    /** Unique id (stable across reloads). */
    id: string;
    /** TipTap extension instance. */
    extension: Extension;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
}

/** Definition for an extendable editor mark extension. */
export interface EditorMark {
    /** Unique id (stable across reloads). */
    id: string;
    /** TipTap extension instance. */
    extension: Extension;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
}

// Global singleton registries (survive HMR) stored on globalThis to avoid duplication.
const g: any = globalThis as any;

const nodesRegistry: Map<string, EditorNode> =
    g.__or3EditorNodesRegistry || (g.__or3EditorNodesRegistry = new Map());

const marksRegistry: Map<string, EditorMark> =
    g.__or3EditorMarksRegistry || (g.__or3EditorMarksRegistry = new Map());

// Reactive wrapper lists we maintain for computed filtering (Map itself not reactive).
const nodesReactiveList = reactive<{ items: EditorNode[] }>({ items: [] });
const marksReactiveList = reactive<{ items: EditorMark[] }>({ items: [] });

function syncNodesReactiveList() {
    nodesReactiveList.items = Array.from(nodesRegistry.values());
}

function syncMarksReactiveList() {
    marksReactiveList.items = Array.from(marksRegistry.values());
}

/** Register (or replace) an editor node extension. */
export function registerEditorNode(node: EditorNode) {
    if (import.meta.dev && nodesRegistry.has(node.id)) {
        console.warn(`[useEditorNodes] Overwriting existing node: ${node.id}`);
    }
    nodesRegistry.set(node.id, node);
    syncNodesReactiveList();
}

/** Unregister a node extension by id (optional utility). */
export function unregisterEditorNode(id: string) {
    if (nodesRegistry.delete(id)) syncNodesReactiveList();
}

/** Register (or replace) an editor mark extension. */
export function registerEditorMark(mark: EditorMark) {
    if (import.meta.dev && marksRegistry.has(mark.id)) {
        console.warn(`[useEditorNodes] Overwriting existing mark: ${mark.id}`);
    }
    marksRegistry.set(mark.id, mark);
    syncMarksReactiveList();
}

/** Unregister a mark extension by id (optional utility). */
export function unregisterEditorMark(id: string) {
    if (marksRegistry.delete(id)) syncMarksReactiveList();
}

/** List all registered node extensions (ordered). */
export function listEditorNodes(): EditorNode[] {
    return nodesReactiveList.items.sort(
        (a, b) => (a.order ?? 200) - (b.order ?? 200)
    );
}

/** List all registered mark extensions (ordered). */
export function listEditorMarks(): EditorMark[] {
    return marksReactiveList.items.sort(
        (a, b) => (a.order ?? 200) - (b.order ?? 200)
    );
}

/** Convenience for plugin authors to check existing node ids. */
export function listRegisteredEditorNodeIds(): string[] {
    return Array.from(nodesRegistry.keys());
}

/** Convenience for plugin authors to check existing mark ids. */
export function listRegisteredEditorMarkIds(): string[] {
    return Array.from(marksRegistry.keys());
}

// Note: Core (built-in) extensions remain hard-coded in DocumentEditor.vue;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
