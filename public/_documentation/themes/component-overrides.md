# Guide: Theme Component Overrides

Theme component overrides let a theme replace selected OR3 app components with
theme-local Vue components.

This is the highest-leverage part of the theme system when you need to change
real structure, layout, or interaction chrome instead of only changing props or
CSS.

Use this guide when:

- a `v-theme` override is not enough
- a `cssSelectors` rule would be fragile or hard to maintain
- you want a theme to ship its own sidebar, chat input, or other major surface

## What Component Overrides Are For

The OR3 theme system has three different layers:

1. `overrides`
   Use these when the component already exposes the right props. This is the
   cheapest and safest option.
2. `cssSelectors`
   Use these when you need to style DOM that cannot easily take `v-theme`, or
   when you are targeting third-party markup.
3. `customComponents`
   Use this when you need to replace the actual Vue component used by the app.

As a rule:

- if the problem is "the button should be a different color", use `overrides`
- if the problem is "this DOM needs extra spacing", use `cssSelectors`
- if the problem is "this entire surface should be structured differently", use
  `customComponents`

Component overrides are intentionally narrow. They do not replace every
component in the app. They replace a curated set of high-value surfaces where
themes often need deeper control.

## Supported Override Targets

`customComponents` keys must come from the shared `AppThemeComponent` union.

Current supported targets:

```ts
type AppThemeComponent =
  | 'sidebar'
  | 'sidebar-collapsed'
  | 'chat-page'
  | 'chat-message'
  | 'chat-input'
  | 'document-editor'
  | 'dashboard-modal'
  | 'model-selector'
  | 'system-prompts-modal'
  | 'model-catalog-modal'
  | 'sidebar-auth-button'
  | 'documentation-shell'
  | 'workflow-status';
```

These are not arbitrary strings. If a key is not in that union, the theme
validator and TypeScript will reject it.

## Directory Layout

Theme component files live inside the theme directory, usually under
`components/`.

Example:

```text
app/theme/my-theme/
  theme.ts
  styles.css
  components/
    MySidebar.vue
    MyChatInput.vue
```

The file paths you register in `customComponents` are resolved relative to the
theme root.

## Registering Component Overrides

Register overrides in `app/theme/<theme>/theme.ts`:

```ts
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
  name: 'my-theme',
  displayName: 'My Theme',
  colors: {
    primary: '#086db8',
    secondary: '#ff6b6b',
    surface: '#ffffff',
  },

  customComponents: {
    sidebar: './components/MySidebar.vue',
    'chat-input': './components/MyChatInput.vue',
  },
});
```

Important rules:

- Paths are relative to the theme directory.
- The path must point to a `.vue` file discovered by the theme runtime.
- You can override one target, several targets, or none.
- Any target you do not override keeps the core default component.

## How The Runtime Applies Overrides

The runtime keeps a default component map for every supported target. When a
theme is activated, the client builds a new component map by merging the theme's
`customComponents` over that default map.

In practical terms:

- No theme override means the app uses the normal core component.
- A valid override path swaps that target to your theme component.
- Invalid or missing paths fall back to the core default instead of crashing the
  whole theme.

### SSR and hydration behavior

Theme component overrides are resolved during SSR and reused during hydration.

The runtime flow is:

1. The server resolves the active theme before render.
2. The server builds the same component map the client will hydrate with.
3. The client hydrates against that same active-theme component tree.

This matters because valid overrides now render correctly in SSR and do not
flash back to the core default during hydration.

If an override path is missing or invalid, the runtime still falls back to the
core default component for that target instead of failing the whole theme.

## The Safest Pattern: Wrap, Do Not Fork

In most cases, the best theme override is a wrapper around the core component.

Why:

- you keep core business logic
- upstream fixes still land automatically
- the theme only owns presentation and small behavior adjustments

For example, a custom sidebar can render the core sidebar inside a wrapper and
apply deep, scoped styling:

```vue
<template>
  <div class="my-sidebar-shell">
    <SideBar
      ref="sidebarRef"
      v-bind="forwardedAttrs"
      :active-thread="props.activeThread ?? undefined"
      @chat-selected="(id) => emit('chat-selected', id)"
      @new-chat="emit('new-chat')"
      @new-document="emit('new-document')"
      @document-selected="(id) => emit('document-selected', id)"
      @toggle-dashboard="emit('toggle-dashboard')"
    />
  </div>
</template>
```

For a custom chat input, the same idea applies:

```vue
<template>
  <div class="my-chat-input-shell">
    <ChatInputDropper
      v-bind="attrs"
      :loading="props.loading"
      :streaming="props.streaming"
      :container-width="props.containerWidth"
      :thread-id="props.threadId"
      :pane-id="props.paneId"
      @send="(payload) => emit('send', payload)"
      @model-change="(model) => emit('model-change', model)"
      @stop-stream="emit('stop-stream')"
      @pending-prompt-selected="(id) => emit('pending-prompt-selected', id)"
      @resize="(payload) => emit('resize', payload)"
    />
  </div>
</template>
```

This pattern keeps the theme override thin and makes breakage far less likely.

## When A Full Fork Makes Sense

Sometimes a wrapper is not enough.

You may need a true theme-local implementation when:

- the DOM structure must be fundamentally different
- you need to remove or reposition core subtrees that cannot be restyled cleanly
- the layout depends on markup the core component does not expose

If you fully fork a component, treat it like a public contract, not a visual
mock.

That means your replacement must still match what the caller expects:

- the same required props
- the same emitted events
- the same exposed methods (if the parent uses `ref` access)

The theme system only swaps components. It does not adapt props, emits, or
exposed instance methods for you.

## Contracts Come From The Call Site

This is the most important rule to understand:

The component contract is defined by the core component that renders the theme
slot, not by the theme system itself.

Examples in the current codebase:

- `chat-input` is rendered by `app/components/chat/ChatContainer.vue`
- `sidebar` is rendered by `app/components/PageShell.vue` and related shell
  layout components

Before replacing a target, inspect the caller and confirm:

- which props are passed in
- which events are listened to
- whether the parent uses a component ref

If you skip this step, the theme may render but silently break real
functionality.

### Current high-value contracts to preserve

These are especially important today:

- `sidebar`
  The parent may rely on exposed methods such as focusing the search input or
  opening create modals.
- `chat-input`
  The caller expects send/stop/model/prompt/resize events to continue working.
- `workflow-status`
  The replacement must preserve the status UI's expected data flow and actions.

If you are unsure, wrap the core component first. That keeps the contract intact
while you iterate on the design.

## Styling Strategies That Age Well

When you build a wrapper component, use one of these two approaches:

### 1. Restyle the wrapper shell

Use this when the main difference is framing:

- background treatment
- panel shape
- spacing
- overlays
- labels or decorative chrome

This is simple and usually stable.

### 2. Use scoped `:deep(...)` selectors against stable class hooks

Use this when you need to restyle the inner component without copying it.

This works best when you target stable semantic hooks such as:

- IDs used for layout containers
- class names that clearly represent a feature area
- wrapper classes already intended for theming or composition

Avoid depending on brittle descendant chains or generated utility-class order.

Good:

```css
:deep(#nav-content-container) {
  border-radius: 2rem;
}

:deep(.sb-group-header) {
  border-radius: 999px;
}
```

Risky:

```css
:deep(.flex > .flex-1 > .mt-3 > div:nth-child(2)) {
  /* fragile */
}
```

## Best Practices

- Prefer wrapping the core component before forking it.
- Keep theme overrides focused on presentation and layout.
- Preserve emits and exposed methods exactly when the parent relies on them.
- Use `defineOptions({ inheritAttrs: false })` when wrapping so you control
  where root attributes land.
- Forward only the attributes that belong on the inner component.
- Keep any extra theme-only markup clearly decorative and easy to remove later.
- Test theme switches at runtime, not only a hard load.
- Validate both desktop and mobile layouts.

## Common Mistakes

### Registering a path that is not relative to the theme root

This is wrong:

```ts
customComponents: {
  sidebar: './app/theme/my-theme/components/MySidebar.vue',
}
```

This is correct:

```ts
customComponents: {
  sidebar: './components/MySidebar.vue',
}
```

### Breaking the parent contract

A replacement that looks correct but drops an event or exposed method is still
broken.

For example:

- a custom chat input that no longer emits `send`
- a custom sidebar that no longer exposes a search-focus method

### Replacing logic when styling would have been enough

If `overrides` or `cssSelectors` can solve the problem, use them first.

Component overrides are powerful, but they are also the easiest way to create
theme drift from core behavior.

## Troubleshooting

### The override never appears

Check these first:

- `customComponents` is defined in the active theme
- the key is valid (`'chat-input'`, not `'chatInput'`)
- the file path is relative to the theme root
- the active theme is the one you think it is

### The override works on the client but breaks behavior

You almost always dropped part of the caller contract.

Inspect the call site and compare:

- props
- emits
- `defineExpose()` methods

### The override appears, but styling is inconsistent

If you wrapped the core component and used deep selectors, your selectors may be
targeting unstable internal structure.

Tighten the targets to stable semantic classes or IDs, or move the visual change
to the wrapper shell instead.

### The override looked fine until a core refactor

That is a sign the theme relied too heavily on internal DOM details.

When possible:

- prefer wrapper-level styling
- prefer stable semantic hooks over structural selectors
- re-check the core component before expanding the override further

## Recommended Workflow

1. Start with `overrides`.
2. Escalate to `cssSelectors` if you only need extra styling control.
3. Use `customComponents` only when you need real component replacement.
4. Wrap the core component first.
5. Fork only after the wrapper approach clearly stops being enough.

That sequence keeps themes flexible without turning them into parallel copies of
the application.
