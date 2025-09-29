import { computed, reactive } from 'vue';
import type { ComputedRef } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { ChromeActionColor } from './useSidebarSections';

export interface ComposerActionContext {
    editor?: Editor | null;
    threadId?: string | null;
    paneId?: string | null;
    isStreaming?: boolean;
    [key: string]: unknown;
}

export interface ComposerAction {
    id: string;
    icon: string;
    tooltip?: string;
    label?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: ComposerActionContext) => void | Promise<void>;
    visible?: (ctx: ComposerActionContext) => boolean;
    disabled?: (ctx: ComposerActionContext) => boolean;
}

export interface ComposerActionEntry {
    action: ComposerAction;
    disabled: boolean;
}

const DEFAULT_ORDER = 200;

const g: any = globalThis as any;
const registry: Map<string, ComposerAction> =
    g.__or3ComposerActionsRegistry ||
    (g.__or3ComposerActionsRegistry = new Map());

const reactiveList = reactive<{ items: ComposerAction[] }>({ items: [] });

function sync() {
    reactiveList.items = Array.from(registry.values());
}

export function registerComposerAction(action: ComposerAction) {
    if (import.meta.dev && registry.has(action.id)) {
        console.warn(
            `[useComposerActions] Overwriting existing action: ${action.id}`
        );
    }
    const frozen = Object.freeze({ ...action });
    registry.set(action.id, frozen);
    sync();
}

export function unregisterComposerAction(id: string) {
    if (registry.delete(id)) sync();
}

export function useComposerActions(
    context: () => ComposerActionContext = () => ({})
): ComputedRef<ComposerActionEntry[]> {
    return computed(() => {
        const ctx = context() || {};
        return reactiveList.items
            .filter((action) => !action.visible || action.visible(ctx))
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            )
            .map((action) => ({
                action,
                disabled: action.disabled ? action.disabled(ctx) : false,
            }));
    });
}

export function listRegisteredComposerActionIds(): string[] {
    return Array.from(registry.keys());
}
