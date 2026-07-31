import { createRegistry } from '../_registry';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export interface HistoryActionRegistryItem<TDocument> {
    id: string;
    /** Owning plugin used for enabled-state and server access checks. */
    pluginId?: string;
    /** Optional per-contribution access requirements. */
    access?: PluginGatePolicy;
    icon: string;
    label: string;
    order?: number;
    handler: (ctx: { document: TDocument }) => void | Promise<void>;
}

export function createHistoryActionRegistry<TDocument, TAction extends HistoryActionRegistryItem<TDocument>>(
    globalKey: string
) {
    const registry = createRegistry<TAction>(globalKey);

    return {
        register(item: TAction) {
            registry.register(item);
        },
        unregister(id: string) {
            registry.unregister(id);
        },
        useItems() {
            return registry.useItems();
        },
        listIds() {
            return registry.listIds();
        },
    };
}
