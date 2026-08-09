# Workflow editor

The workflow editor is a node canvas for building and testing saved workflows.

## Toolbar

The toolbar follows the document editor's sizing and responsive contract: shared theme tokens, 40px desktop controls, a 900px compact breakpoint, a scrollable primary rail, and pinned workflow actions. The workflow name and save state appear when the pane is wide enough; narrow panes keep controls contained so they never overlap an adjacent pane.

- **Pan / Select** switches between dragging the canvas and marquee-selecting nodes. In Pan mode, hold Shift while dragging to marquee-select. In Select mode, switch back to Pan or hold Space while dragging to move the canvas.
- **Delete** removes selected nodes or connections and is disabled when nothing deletable is selected. The Start trigger cannot be deleted.
- **Validation** updates automatically. Select its status to open the issue list; **Open node** selects the affected node and opens its inspector.
- **Run** saves the workflow, reuses or opens a chat pane, and executes through the normal chat workflow pipeline. Validation errors disable Run; warnings do not.
- **More** contains export and whole-canvas clearing actions.

## Canvas interaction

Nodes are selected with a click and moved by dragging. In Pan mode, drag empty canvas space to pan or Shift-drag to marquee-select. In Select mode, drag empty space to marquee-select. Scroll or pinch to zoom.

Connection handles expose their purpose with accessible labels. Drag an output handle onto empty canvas to choose and automatically connect a compatible common node. Double-click empty canvas to open the same quick-add menu without creating a connection. Edges use arrowheads to show execution direction.

Validation issues appear directly on affected nodes. Activating the issue indicator opens that node in the inspector.

## Local package development

When a sibling `or3-workflows` checkout exists, `nuxt.config.ts` aliases `or3-workflow-core`, `or3-workflow-vue`, and the workflow stylesheet to package source. Nuxt therefore hot-reloads workflow component and style changes without publishing or rebuilding the registry package. Installed package versions remain the fallback for generated projects and deployments without the sibling checkout.
