# usePaneResizeController

Controller for resizing panes in the multi-pane workspace. It wires pointer-drag resizing, keyboard resizing, and container-width recalculation into a single component.

## Purpose

`usePaneResizeController(options)` returns:

-   `paneContainerRef` — bind to the pane container element. Its width is observed and fed back through `recalculateWidths`.
-   `isResizing` — reactive flag while a drag is in progress.
-   `onPaneResizeStart(event, paneIndex)` — begin a drag on a pane divider.
-   `onPaneResizeKeydown(event, paneIndex)` — handle keyboard resize on a focused divider.

Behavior:

-   Dragging is disabled on mobile.
-   Drag deltas are batched per animation frame for smoothness.
-   Arrow keys resize by 16px (32px with Shift); `Home`/`End` jump to min width or max width.
-   Widths are persisted on drag end via the `persist` callback.
-   Container width changes (window resize) are debounced by 100ms before recalculation.
-   When the pane count changes, widths are reconciled explicitly after the DOM updates.

## Options

```ts
usePaneResizeController({
    paneCount: () => panes.value.length,
    paneWidths,            // Ref<number[]>
    isMobile,              // Ref<boolean>
    minPaneWidth,          // number
    recalculateWidths,     // (width) => void
    resize,                // (paneIndex, deltaX, persist) => void
    persist,               // () => void
});
```

## Usage

```vue
<template>
    <div ref="paneContainerRef" class="pane-container">
        <div
            v-for="(pane, index) in panes"
            :key="pane.id"
            class="pane"
        >
            <!-- divider between panes -->
            <div
                class="pane-divider"
                @pointerdown="onPaneResizeStart($event, index)"
                @keydown="onPaneResizeKeydown($event, index)"
            />
        </div>
    </div>
</template>
```

## Notes

-   Pointer capture keeps the drag alive outside the divider.
-   Persist is only called at drag end, not during movement.

## Related

-   `useMultiPane` — the pane state the controller resizes.
-   `useResponsiveState` — the `isMobile` source.
