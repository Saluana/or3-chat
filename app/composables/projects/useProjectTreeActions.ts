import { createRegistry, type RegistryItem } from '#imports';

// Local interfaces describing the tree rows printed in the console.
// These mirror the shape produced by SidebarProjectTree.vue for root and child items.
export type ProjectTreeKind = 'chat' | 'doc';
export type ShowOnKind = 'root' | 'all' | 'chat' | 'doc';

export interface ProjectTreeChild {
    value: string; // id of the entry
    label: string;
    icon?: string;
    kind?: ProjectTreeKind; // 'chat' | 'doc'
    parentId?: string;
    onSelect?: (e: Event) => void;
}

export interface ProjectTreeRoot {
    value: string; // project id
    label: string; // project name
    defaultExpanded?: boolean;
    children?: ProjectTreeChild[];
    onSelect?: (e: Event) => void;
}

export type ProjectTreeRow = ProjectTreeRoot | ProjectTreeChild;

export interface ProjectTreeHandlerCtx {
    // The tree row this action was invoked for (root or child)
    treeRow: ProjectTreeRow;
    // legacy/alternate shapes seen in the wild may include a `child` property
    // but prefer to use `treeRow`.
    child?: ProjectTreeChild;
    root?: ProjectTreeRoot;
}

/** Definition for an extendable chat message action button. */
export interface ProjectTreeAction extends RegistryItem {
    /** Unique id (stable across reloads). */
    id: string;
    /** Icon name (passed to UButton icon prop). */
    icon: string;
    /** Label text. */
    label: string;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
    showOn?: ShowOnKind[]; // if present, limits visibility to these kinds
    /** Handler invoked on click. */
    handler: (ctx: ProjectTreeHandlerCtx) => void | Promise<void>;
}

// Create registry using factory with default sort behavior
const registry = createRegistry<ProjectTreeAction>(
    '__or3ProjectTreeActionsRegistry'
);

/** Register (or replace) a message action. */
export function registerProjectTreeAction(action: ProjectTreeAction) {
    registry.register(action);
}

/** Unregister an action by id (optional utility). */
export function unregisterProjectTreeAction(id: string) {
    registry.unregister(id);
}

/** Accessor for actions applicable to a specific message. */
export function useProjectTreeActions() {
    return registry.useItems();
}

/** Convenience for plugin authors to check existing action ids. */
export function listRegisteredProjectTreeActionIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) actions remain hard-coded in ChatProjectTree.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
