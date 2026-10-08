# Replace app components

A trusted-code theme can replace selected Vue surfaces with theme-local
components. Start with [Style your theme](/documentation/themes/styling) when
tokens, recipes, or CSS can express the change. Declarative packages cannot ship
Vue replacements.

## Supported targets

`customComponents` keys are the `AppThemeComponent` union:

```ts
type AppThemeComponent =
  | 'sidebar' | 'sidebar-collapsed' | 'chat-page' | 'chat-message'
  | 'chat-input' | 'document-editor' | 'dashboard-modal' | 'model-selector'
  | 'system-prompts-modal' | 'model-catalog-modal' | 'sidebar-auth-button'
  | 'documentation-shell' | 'workflow-status';
```

TypeScript checks these keys. Current runtime configuration validation checks
the contract version but does not reject every unknown key or validate every
replacement's props/events. Unknown keys are not useful targets. Missing/unsafe
paths fall back to the core default, so inspect the rendered component too.

## A complete wrapper example

Create a trusted source theme with `bun run theme:create ocean-docs`. Add
`app/theme/ocean-docs/components/OceanDocumentation.vue`:

```vue
<script setup lang="ts">
import { useAttrs } from 'vue';
import CoreDocumentationShell from '~/components/DocumentationShell.vue';

defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
</script>

<template>
  <CoreDocumentationShell v-bind="attrs" class="ocean-documentation" />
</template>

<style scoped>
.ocean-documentation :deep(.docs-header) {
  border-bottom: 2px solid var(--md-primary);
}
</style>
```

This wrapper forwards supplied props and listeners through attrs and uses the
actual core import, rather than resolving its own themed slot recursively.
This target does not need a forwarded exposed-method contract or custom slots.
That is not a universal wrapper pattern: inspect other targets' callers before
reusing it.

Add these fields to the scaffold's existing `defineTheme()` object:

```ts
customComponents: {
  'documentation-shell': './components/OceanDocumentation.vue',
},
componentContractVersion: 1,
```

Paths are relative to the theme root and must name discovered `.vue` files.
Declare the current contract version, `1`. A mismatch is a validation error;
omitting it with replacements currently produces a warning. A packaged manifest
also declares `themeTrust: 'trusted-code'` and the relevant contract version.

Run `bun run theme:validate ocean-docs`, select Ocean docs in Theme studio, then
open documentation and verify the header, search, navigation, and mobile drawer.
Switch to another theme and back, and reload the documentation route. A new
production component needs a rebuild, not just a package upload.

## Preserve the caller contract

The theme system swaps components; it does not adapt props, events, slots, or
exposed methods. Inspect the core implementation and each caller.

| Target | Important boundary |
| --- | --- |
| Sidebar | Navigation/create events and any search/modal methods used through a ref |
| Chat input | Loading/streaming and pane/thread data; send, model, stop, prompt, and resize events; draft/attachment lifecycle |
| Document editor | Editor data/events, focus, selection, and ref methods used by its callers |
| Workflow status | Installed workflow package's data/actions and accessible status updates |

`theme-component-contracts.ts` provides guidance for all target names, with
specific contracts for some high-value targets. It is not exhaustive automatic
conformance enforcement. The workflow slot's core default is empty; an installed
Workflows package supplies its real default status surface.

A wrapper needing slots must forward those slots. A wrapper around a component
used through a ref must explicitly expose the methods the parent calls. Do not
assume `$attrs` forwards instance methods. Prefer a direct core import plus a
small presentational change; a full fork owns the behavior and maintenance cost.
Use stable class hooks rather than descendant chains or generated utility order.

## Dialogs and accessibility

Keep shared dialogs on `~/components/ui/AppModal.vue`. It wraps `UModal` and
owns bounded geometry, title/description semantics, focus, Escape, backdrop
dismissal, and focus restoration. Theme tokens own its visual treatment.

```vue
<AppModal v-model:open="open" title="Theme details" description="Preview this theme." size="sm">
  <p>Check this surface in light and dark mode.</p>
  <template #footer>
    <UButton variant="ghost" size="modal" @click="open = false">Close</UButton>
  </template>
</AppModal>
```

Here `open` is a component-owned boolean ref. Use `sm`, `md`, `lg`, or
`workspace`; the workspace layout has independently scrolling content and fills
narrow screens. Modal control variants are defined in `app/app.config.ts`.
Theme `ui` overrides must respect the shell's shared geometry. Preserve nested
dialog focus scopes and do not add global Escape listeners or a second body
scroll lock. Custom UModal hosts use the existing `useDialogFocus` helper for
viewport and focus behavior rather than reimplementing it.

## Verify the replacement

Check runtime theme switches, a hard reload, SSR hydration, keyboard navigation,
mobile controls, reduced motion, and all caller actions. For chat replacements,
include send/stop, attachment removal, editor focus, and narrow/short panes.
Retain screenshots and the host revision with the theme. A visually correct
replacement that drops a caller event is still broken. Use
[Troubleshooting](/documentation/themes/troubleshooting) when the replacement
falls back or stops working after a host refactor.

## Preserve tool cards in chat-message replacements

Render ChatToolBlock for ordered and legacy tool blocks, and ChatToolCardsEnd after the body. Forward their resize events as content-resize so the message list updates its measured height. Keep the user cardOrigin attribution chip. See [Tool cards](/documentation/plugins/tool-cards).
