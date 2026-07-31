import { computed } from 'vue';
import { createRegistry } from '../_registry';
import { getContributionSurfaceKernel } from '../plugins/contribution-surface-kernel';
import { getContributionSurfaceSelection } from '../plugins/contribution-surface-selection';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export type DocumentAiScope = 'selection' | 'section' | 'document';

export interface DocumentAiAction {
    id: string;
    label: string;
    prompt: string;
    icon?: string;
    defaultScope?: DocumentAiScope;
    order?: number;
    pluginId?: string;
    access?: PluginGatePolicy;
}

const registry = createRegistry<DocumentAiAction>('__or3DocumentAiActionsRegistry');
const kernel = getContributionSurfaceKernel<DocumentAiAction>('document-ai-actions', {
    getId: (action) => action.id,
    normalize: (action) => Object.freeze({ ...action }),
    compare: (left, right) => (left.order ?? 200) - (right.order ?? 200)
        || left.id.localeCompare(right.id),
});

function useV2Surface() {
    return getContributionSurfaceSelection().isSelected('document-ai-actions');
}

export function registerDocumentAiAction(action: DocumentAiAction) {
    return useV2Surface()
        ? kernel.registry.registerLegacy({ value: action })
        : registry.register(action);
}

export function unregisterDocumentAiAction(id: string) {
    if (useV2Surface()) kernel.registry.unregisterLegacy(id);
    else registry.unregister(id);
}

export function useDocumentAiActions() {
    const actions = useV2Surface() ? kernel.items : registry.useItems();
    return computed(() => actions.value.filter((action) =>
        getPluginGateDecision(action.pluginId, action.access).allowed
    ));
}
