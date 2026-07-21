import { computed, type Component } from 'vue';
import { createRegistry } from '../_registry';
import { getContributionSurfaceKernel } from '../plugins/contribution-surface-kernel';
import { getContributionSurfaceSelection } from '../plugins/contribution-surface-selection';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export interface EditorInspectorPanel {
    id: string;
    label: string;
    icon?: string;
    component: Component;
    order?: number;
    pluginId?: string;
    access?: PluginGatePolicy;
}

const registry = createRegistry<EditorInspectorPanel>('__or3EditorInspectorPanelsRegistry');
const kernel = getContributionSurfaceKernel<EditorInspectorPanel>(
    'editor-inspector-panels',
    {
        getId: (panel) => panel.id,
        normalize: (panel) => Object.freeze({ ...panel }),
        compare: (left, right) => (left.order ?? 200) - (right.order ?? 200)
            || left.id.localeCompare(right.id),
    }
);

function useV2Surface() {
    return getContributionSurfaceSelection().isSelected('editor-inspector-panels');
}

export function registerEditorInspectorPanel(panel: EditorInspectorPanel) {
    return useV2Surface()
        ? kernel.registry.registerLegacy({ value: panel })
        : registry.register(panel);
}

export function unregisterEditorInspectorPanel(id: string) {
    if (useV2Surface()) kernel.registry.unregisterLegacy(id);
    else registry.unregister(id);
}

export function useEditorInspectorPanels() {
    const panels = useV2Surface() ? kernel.items : registry.useItems();
    return computed(() => panels.value.filter((panel) =>
        getPluginGateDecision(panel.pluginId, panel.access).allowed
    ));
}
