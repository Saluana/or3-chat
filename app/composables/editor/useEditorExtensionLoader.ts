import type { Node, Mark, Extension } from '@tiptap/core';
import { useLazyBoundaries } from '../core/useLazyBoundaries';
import type { EditorNode, EditorMark, EditorExtension } from './useEditorNodes';

/**
 * Lazy extension factory types that return promises resolving to TipTap extensions.
 */
export type LazyEditorNodeFactory = () => Promise<Node>;
export type LazyEditorMarkFactory = () => Promise<Mark>;
export type LazyEditorExtensionFactory = () => Promise<Extension>;

/**
 * Extension descriptor that can be either eager (already loaded) or lazy (factory).
 */
export interface EditorNodeDescriptor {
    id: string;
    extension?: Node;
    factory?: LazyEditorNodeFactory;
    order?: number;
}

export interface EditorMarkDescriptor {
    id: string;
    extension?: Mark;
    factory?: LazyEditorMarkFactory;
    order?: number;
}

export interface EditorExtensionDescriptor {
    id: string;
    extension?: Extension;
    factory?: LazyEditorExtensionFactory;
    order?: number;
}

/**
 * Result of loading all lazy extensions.
 */
export interface LoadedExtensions {
    nodes: Node[];
    marks: Mark[];
    extensions: Extension[];
}

/**
 * Load all lazy editor extensions, resolving factories and skipping failures.
 */
export async function loadEditorExtensions(
    nodeDescriptors: Array<EditorNode | EditorNodeDescriptor>,
    markDescriptors: Array<EditorMark | EditorMarkDescriptor>,
    extensionDescriptors: Array<EditorExtension | EditorExtensionDescriptor>
): Promise<LoadedExtensions> {
    const lazyBoundaries = useLazyBoundaries();

    // Load nodes
    const nodes: Node[] = [];
    for (const desc of nodeDescriptors) {
        try {
            if ('extension' in desc && desc.extension) {
                // Already loaded
                nodes.push(desc.extension);
            } else if ('factory' in desc && desc.factory) {
                // Lazy load with unique key per extension
                const node = await lazyBoundaries.load({
                    key: `editor-extensions:node:${desc.id}` as any,
                    loader: desc.factory,
                });
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
                const mark = await lazyBoundaries.load({
                    key: `editor-extensions:mark:${desc.id}` as any,
                    loader: desc.factory,
                });
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
                const ext = await lazyBoundaries.load({
                    key: `editor-extensions:ext:${desc.id}` as any,
                    loader: desc.factory,
                });
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
 * Helper to create a lazy node factory from a dynamic import.
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
 * Helper to create a lazy mark factory from a dynamic import.
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
 * Helper to create a lazy extension factory from a dynamic import.
 */
export function createLazyExtensionFactory(
    importFn: () => Promise<{ default: Extension } | Extension>
): LazyEditorExtensionFactory {
    return async () => {
        const mod = await importFn();
        return 'default' in mod ? mod.default : mod;
    };
}
