import { createRegistry } from '../_registry';

export interface HistoryActionRegistryItem<TDocument> {
    id: string;
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
