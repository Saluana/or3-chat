# Style your theme

Start with [Build your first theme](/documentation/themes/first-theme). Add one
feature at a time and verify it in both color modes. JSON themes use the same
visual fields as `theme.ts`, but cannot contain imports, functions, or Vue code.

## Choose the smallest styling layer

| Layer | Use it for |
| --- | --- |
| Tokens | Shared colors, fonts, shape, density, focus, motion, and elevation |
| `ui` | Generic Nuxt UI slot and variant recipes |
| `overrides` | A component, context, or named control that already uses the resolver |
| `cssSelectors` | Third-party or other DOM that needs scoped rules |
| Local stylesheet | CSS effects, media/container queries, and complex selectors |
| `customComponents` | Structural Vue replacement; trusted-code only |

Theme fields and token names are listed in
[Theme reference](/documentation/themes/api-reference). Custom camelCase color
keys become `--md-kebab-case` variables. Tokens contain full CSS values; use
`var(--md-primary)`, not `rgb(var(--md-primary))`.

## Style a named control

Merge this JSON fragment into your definition:

```json
{
  "overrides": {
    "button": { "variant": "solid" },
    "button.chat": { "variant": "ghost" },
    "button#chat.send": { "color": "primary", "size": "lg" }
  }
}
```

The syntax is `component[.context][#identifier]`, with optional state/attribute
matching. Generic, context, and identifier matches merge by specificity. Use
actual host identifiers; inspect a control's theme annotations or the shipped
themes before inventing a target. An override does not attach theming to arbitrary
unregistered controls.

For source components, bind reactive props through `useThemeOverrides()`:

```vue
<script setup lang="ts">
const sendTheme = useThemeOverrides({
  component: 'button', context: 'chat', identifier: 'chat.send', isNuxtUI: true,
});
</script>

<template>
  <UButton v-bind="sendTheme" v-theme="{ identifier: 'chat.send', context: 'chat' }">
    Send
  </UButton>
</template>
```

`v-bind` changes Vue props. `v-theme` decorates the rendered DOM with owned
classes, styles, and annotations; it cannot mutate component props. Keep live
behavior such as disabled/loading explicit. Automatic directive context detection
recognizes only chat, sidebar, dashboard, and header. For other known contexts,
pass `context` explicitly to both the resolver and directive. An arbitrary
`data-context` wrapper alone does not enable detection. The directive supplies
`state: 'default'`; use CSS for actual hover/focus states.

## Generic control recipes

A `ui` field patches Nuxt UI's slots/variants. This fragment gives inputs a
shared control height and radius:

```json
{
  "ui": {
    "input": {
      "slots": {
        "base": "h-[var(--app-control-height-medium,36px)] rounded-[var(--md-border-radius-small,var(--md-border-radius))]"
      }
    }
  }
}
```

Patch only the slots you need. Preserve labels, focus styles, loading states,
and disabled behavior. Theme recipes describe presentation, not application
logic. Local component props and the shared dialog shell can take precedence.

## Background layers

Authored `backgrounds` supply defaults for workspace base/overlay, sidebar,
header gradient, and bottom navigation. Personal overrides can replace them
without changing the package. Disabling personal background overrides restores
authored values.

Merge a layer into the theme definition, for example:

```json
{
  "backgrounds": {
    "content": {
      "base": { "image": "/bg-repeat.webp", "opacity": 0.08, "repeat": "repeat", "size": "150px" }
    }
  }
}
```

Include referenced local assets in the package. Keep texture opacity low enough
for readable text, and check both color modes and responsive layouts. Use
`fit: 'cover'` or `'contain'` for responsive image sizing; use explicit
`size` for repeating patterns. Layer fields are in the
[theme reference](/documentation/themes/api-reference#themebackgroundlayer).

The runtime resolves saved file tokens to object URLs and owns their cleanup.
It applies `--app-content-bg-1`/`--app-content-bg-2` and
`--app-sidebar-bg-1` with opacity/repeat/size companions, plus
`--app-header-gradient` and `--app-bottomnav-gradient`. Use the existing
background helper rather than introducing parallel token or URL ownership.

## Icons

Declare semantic tokens in your definition:

```json
{
  "icons": {
    "chat.send": "tabler:send",
    "ui.trash": "tabler:trash"
  }
}
```

`app/config/icon-tokens.ts` is the token catalog. Trusted themes can alternatively
export an `IconMap` from `icons.config.ts`; keep overrides in one place to avoid
ambiguous maintenance. Adding a new semantic token requires a host source change.
For source Vue code, resolve icons in setup so template unwrapping works:

```vue
<script setup lang="ts">
const trashIcon = useIcon('ui.trash');
</script>

<template><UIcon :name="trashIcon" /></template>
```

In script, read `trashIcon.value`. Do not pass a newly created computed ref from
an inline `useIcon()` template call as an icon name.

## CSS selectors and local assets

`cssSelectors.style` generates scoped CSS; `cssSelectors.class` adds runtime
classes. For example:

```json
{
  "cssSelectors": {
    ".monaco-editor": {
      "style": { "border": "1px solid var(--md-outline)" },
      "class": "rounded-md"
    }
  }
}
```

Run `bun run theme:build-css` from the host checkout when using style selectors.
The host loads `/themes/<name>.css`. Runtime class sessions observe newly added
nodes and remove their owned classes on theme changes. They do not promise to
re-evaluate every attribute change on existing nodes. Do not call the obsolete
`useThemeClasses()` helper or add a global force-render mechanism.

For a local stylesheet, create `styles.css` first, then declare
`"stylesheets": ["./styles.css"]`. Scope raw rules yourself:

```css
[data-theme="ocean-theme"] .monaco-editor {
  border-radius: var(--md-border-radius);
}
```

External stylesheets are rejected. Trusted source themes can resolve image URLs
with `new URL('./assets/banner.png', import.meta.url).href` after adding the file.
Do not assume a package-relative image string has the same URL resolution as a
stylesheet. Check the image in the built deployment before distribution. Declaring
a font stack does not download a font; use bundled fonts or package local font
files and define `@font-face` in your scoped stylesheet.

## Dialogs and responsive layouts

The shared `AppModal` uses theme surface/text, border, radius, elevation, and
focus tokens while owning its geometry. Sizes are `sm` (560px), `md` (700px),
`lg` (880px), and `workspace` (1280px with bounded height). Respect its scrolling
body, accessible title, close control, and footer; do not replace geometry through
generic modal slot recipes. See
[Replace app components](/documentation/themes/component-overrides#dialogs-and-accessibility).

Use token fallbacks for optional appearance fields. Keep touch edit controls at
least 16px to avoid focus zoom and interactive regions at least 44px. Preserve
page zoom and reduced-motion behavior. Test narrow split panes as well as narrow
browser windows; container queries suit pane content. Give scrolling flex children
`min-height: 0`, bound canvas heights, and keep footer actions reachable. A composer
replacement must retain the host's viewport, draft, attachment, and touch behavior.

The shared chat composer reserves separate 44px touch regions around its 32px
icon buttons on phones. Keep any expanded hit area inside that reserved space;
do not let neighboring targets overlap. Blank's composer replacement uses native
44px buttons. Message actions keep a centered, joined 32px-tall strip with separate
44px touch regions, wrapping in normal flow on touch screens and in narrow chat
panes. Keep desktop positioning in the component stylesheet rather than
adding translation utilities that remain active when mobile resets `transform`.
Retro integrates user and assistant message actions into a right-aligned footer
with inherited text color and a subtle divider; shared CSS retains the touch
regions and wrapping.
