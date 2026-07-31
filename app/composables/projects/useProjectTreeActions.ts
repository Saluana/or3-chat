import { computed } from 'vue';
import { createRegistry, type RegistryItem } from '#imports';
import { getContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';
import { getContributionSurfaceKernel } from '~/composables/plugins/contribution-surface-kernel';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

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
    /** Owning plugin used for enabled-state and server access checks. */
    pluginId?: string;
    /** Optional per-contribution access requirements. */
    access?: PluginGatePolicy;
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
const v2Kernel = getContributionSurfaceKernel<ProjectTreeAction>('project-tree-actions', {
    getId: (action) => action.id,
    normalize: (action) => Object.freeze({ ...action }),
    compare: (left, right) =>
        (left.order ?? 200) - (right.order ?? 200) || left.id.localeCompare(right.id),
});

function useV2Surface(): boolean {
    return getContributionSurfaceSelection().isSelected('project-tree-actions');
}

/** Register (or replace) a message action. */
export function registerProjectTreeAction(action: ProjectTreeAction) {
    if (useV2Surface()) v2Kernel.registry.registerLegacy({ value: action });
    else registry.register(action);
}

/** Unregister an action by id (optional utility). */
export function unregisterProjectTreeAction(id: string) {
    if (useV2Surface()) v2Kernel.registry.unregisterLegacy(id);
    else registry.unregister(id);
}

/** Accessor for actions applicable to a specific message. */
export function useProjectTreeActions() {
    const items = useV2Surface() ? v2Kernel.items : registry.useItems();
    return computed(() =>
        items.value.filter(
            (action) =>
                getPluginGateDecision(action.pluginId, action.access).allowed
        )
    );
}

/** Convenience for plugin authors to check existing action ids. */
export function listRegisteredProjectTreeActionIds(): string[] {
    return useV2Surface() ? [...v2Kernel.registry.listLegacyIds()] : registry.listIds();
}

// Note: Core (built-in) actions remain hard-coded in ChatProjectTree.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
