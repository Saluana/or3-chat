import type { Node, Mark, Extension } from '@tiptap/core';
import type { EditorNode, EditorMark, EditorExtension } from './useEditorNodes';

/**
 * @module app/composables/editor/useEditorExtensionLoader
 *
 * Purpose:
 * Resolve editor extension descriptors into concrete TipTap extensions while
 * keeping TipTap code split boundaries intact.
 *
 * Responsibilities:
 * - Define lazy factory types for TipTap extensions
 * - Provide descriptor shapes for eager or lazy extension registration
 * - Resolve descriptors into extension instances with fault isolation
 *
 * Non-responsibilities:
 * - Registering extensions in global registries
 * - Ordering or filtering extensions after resolution
 * - Retrying failed extension imports
 */

/**
 * Lazy extension factory types that resolve to TipTap extensions.
 *
 * Purpose:
 * Represent deferred imports so plugins can register extensions without
 * pulling TipTap into the entry bundle.
 *
 * Behavior:
 * Factories return a Promise that resolves to a TipTap extension instance.
 *
 * Constraints:
 * - Factories are expected to resolve successfully on the client
 * - Errors are handled by the loader, not by the factories
 *
 * Non-Goals:
 * - Tracking lazy boundaries for analytics or diagnostics
 */
export type LazyEditorNodeFactory = () => Promise<Node>;
export type LazyEditorMarkFactory = () => Promise<Mark>;
export type LazyEditorExtensionFactory = () => Promise<Extension>;

/**
 * Descriptor for a node extension that can be eager (loaded) or lazy (factory).
 *
 * Purpose:
 * Describe how to obtain a TipTap node extension, either immediately or lazily.
 *
 * Behavior:
 * The loader resolves `extension` directly or calls `factory` if provided.
 *
 * Constraints:
 * - `id` must be stable across reloads to keep logging deterministic
 * - Only one of `extension` or `factory` should be provided
 *
 * Non-Goals:
 * - Enforcing uniqueness across registries
 */
export interface EditorNodeDescriptor {
    /** Stable identifier used for registry lookups and logs. */
    id: string;
    /** Preloaded TipTap node extension instance. */
    extension?: Node;
    /** Lazy factory for a TipTap node extension. */
    factory?: LazyEditorNodeFactory;
    /** Optional ordering (lower = earlier). Defaults to 200. */
    order?: number;
}

/**
 * Descriptor for a mark extension that can be eager (loaded) or lazy (factory).
 *
 * Purpose:
 * Describe how to obtain a TipTap mark extension, either immediately or lazily.
 *
 * Behavior:
 * The loader resolves `extension` directly or calls `factory` if provided.
 *
 * Constraints:
 * - `id` must be stable across reloads to keep logging deterministic
 * - Only one of `extension` or `factory` should be provided
 *
 * Non-Goals:
 * - Enforcing uniqueness across registries
 */
export interface EditorMarkDescriptor {
    /** Stable identifier used for registry lookups and logs. */
    id: string;
    /** Preloaded TipTap mark extension instance. */
    extension?: Mark;
    /** Lazy factory for a TipTap mark extension. */
    factory?: LazyEditorMarkFactory;
    /** Optional ordering (lower = earlier). Defaults to 200. */
    order?: number;
}

/**
 * Descriptor for a generic extension that can be eager (loaded) or lazy (factory).
 *
 * Purpose:
 * Describe how to obtain a TipTap extension, either immediately or lazily.
 *
 * Behavior:
 * The loader resolves `extension` directly or calls `factory` if provided.
 *
 * Constraints:
 * - `id` must be stable across reloads to keep logging deterministic
 * - Only one of `extension` or `factory` should be provided
 *
 * Non-Goals:
 * - Enforcing uniqueness across registries
 */
export interface EditorExtensionDescriptor {
    /** Stable identifier used for registry lookups and logs. */
    id: string;
    /** Preloaded TipTap extension instance. */
    extension?: Extension;
    /** Lazy factory for a TipTap extension. */
    factory?: LazyEditorExtensionFactory;
    /** Optional ordering (lower = earlier). Defaults to 200. */
    order?: number;
}

/**
 * Result of resolving all extension descriptors.
 *
 * Purpose:
 * Provide resolved TipTap extensions grouped by extension type.
 *
 * Behavior:
 * Contains the resolved instances in the order they were processed.
 *
 * Constraints:
 * - Failed descriptors are omitted from the arrays
 *
 * Non-Goals:
 * - Reporting or aggregating errors
 */
export interface LoadedExtensions {
    nodes: Node[];
    marks: Mark[];
    extensions: Extension[];
}

/**
 * Resolve editor extension descriptors into concrete TipTap extensions.
 *
 * Purpose:
 * Convert a mix of eager extensions and lazy factories into ready-to-use
 * TipTap extension instances.
 *
 * Behavior:
 * Processes node, mark, and generic extension descriptors in order and skips
 * any descriptor that throws during resolution.
 *
 * Constraints:
 * - Resolution is sequential per list
 * - Errors are logged and not rethrown
 *
 * Non-Goals:
 * - Parallel resolution or batching
 * - Ordering or filtering beyond input ordering
 */
export async function loadEditorExtensions(
    nodeDescriptors: Array<EditorNode | EditorNodeDescriptor>,
    markDescriptors: Array<EditorMark | EditorMarkDescriptor>,
    extensionDescriptors: Array<EditorExtension | EditorExtensionDescriptor>
): Promise<LoadedExtensions> {
    // Load nodes
    const nodes: Node[] = [];
    for (const desc of nodeDescriptors) {
        try {
            if ('extension' in desc && desc.extension) {
                // Already loaded
                nodes.push(desc.extension);
            } else if ('factory' in desc && desc.factory) {
                // Lazy load
                const node = await desc.factory();
                nodes.push(node);
            }
        } catch (error) {
            console.warn(
                `[EditorExtensionLoader] Failed to load node ${desc.id}:`,
                error
            );
            // Skip this extension and continue
        }
    }

    // Load marks
    const marks: Mark[] = [];
    for (const desc of markDescriptors) {
        try {
            if ('extension' in desc && desc.extension) {
                marks.push(desc.extension);
            } else if ('factory' in desc && desc.factory) {
                const mark = await desc.factory();
                marks.push(mark);
            }
        } catch (error) {
            console.warn(
                `[EditorExtensionLoader] Failed to load mark ${desc.id}:`,
                error
            );
        }
    }

    // Load extensions
    const extensions: Extension[] = [];
    for (const desc of extensionDescriptors) {
        try {
            if ('extension' in desc && desc.extension) {
                extensions.push(desc.extension);
            } else if ('factory' in desc && desc.factory) {
                const ext = await desc.factory();
                extensions.push(ext);
            }
        } catch (error) {
            console.warn(
                `[EditorExtensionLoader] Failed to load extension ${desc.id}:`,
                error
            );
        }
    }

    return { nodes, marks, extensions };
}

/**
 * Create a lazy node factory from a dynamic import.
 *
 * Purpose:
 * Wrap a dynamic import so node extensions can be registered lazily.
 *
 * Behavior:
 * Resolves either the default export or the module itself if it is a Node.
 *
 * Constraints:
 * - Import function must resolve to a TipTap Node module
 *
 * Non-Goals:
 * - Handling non-node exports
 *
 * @example
 * ```ts
 * registerEditorNode({
 *   id: 'mention',
 *   factory: createLazyNodeFactory(() => import('./extensions/mention')),
 * });
 * ```
 */
export function createLazyNodeFactory(
    importFn: () => Promise<{ default: Node } | Node>
): LazyEditorNodeFactory {
    return async () => {
        const mod = await importFn();
        return 'default' in mod ? mod.default : mod;
    };
}

/**
 * Create a lazy mark factory from a dynamic import.
 *
 * Purpose:
 * Wrap a dynamic import so mark extensions can be registered lazily.
 *
 * Behavior:
 * Resolves either the default export or the module itself if it is a Mark.
 *
 * Constraints:
 * - Import function must resolve to a TipTap Mark module
 *
 * Non-Goals:
 * - Handling non-mark exports
 */
export function createLazyMarkFactory(
    importFn: () => Promise<{ default: Mark } | Mark>
): LazyEditorMarkFactory {
    return async () => {
        const mod = await importFn();
        return 'default' in mod ? mod.default : mod;
    };
}

/**
 * Create a lazy extension factory from a dynamic import.
 *
 * Purpose:
 * Wrap a dynamic import so generic extensions can be registered lazily.
 *
 * Behavior:
 * Resolves either the default export or the module itself if it is an Extension.
 *
 * Constraints:
 * - Import function must resolve to a TipTap Extension module
 *
 * Non-Goals:
 * - Handling non-extension exports
 */
export function createLazyExtensionFactory(
    importFn: () => Promise<{ default: Extension } | Extension>
): LazyEditorExtensionFactory {
    return async () => {
        const mod = await importFn();
        return 'default' in mod ? mod.default : mod;
    };
}
