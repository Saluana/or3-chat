# useEditorInspectorPanels

Registry for the document editor's side inspector panels. Plugins add panels that render contextual tools beside the editor.

## Purpose

-   `registerEditorInspectorPanel(panel)` — add or replace a panel.
-   `unregisterEditorInspectorPanel(id)` — remove a panel.
-   `useEditorInspectorPanels()` — computed, sorted, access-filtered list of panels.

`EditorInspectorPanel`:

```ts
{
    id: string;
    label: string;
    icon?: string;
    component: Component;
    order?: number; // default 200
    pluginId?: string;
    access?: PluginGatePolicy;
}
```

## Usage

```ts
import { registerEditorInspectorPanel } from '~/composables/editor/useEditorInspectorPanels';

registerEditorInspectorPanel({
    id: 'my-plugin:stats',
    label: 'Stats',
    icon: 'i-ph-chart-bar',
    component: () => import('~/components/inspector/StatsPanel.vue'),
    order: 180,
});
```

## Notes

-   Panels sort by `order`, then id.
-   Access-gated panels are filtered out automatically.

## Related

-   `useEditorNodes` — sibling registry for TipTap extensions.
-   `useEditorToolbar` — sibling registry for toolbar buttons.
