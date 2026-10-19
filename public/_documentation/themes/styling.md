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

## Action menus

Host action menus share the `or3-action-menu` recipe in
`app/assets/css/action-menu.css`: 14px regular text, 20px line height, 18px icons,
and 36px rows (at least 44px on mobile). Dropdowns, sidebar action popovers,
and tab menus use it; chat settings and form/model pickers remain separate.
Colors, destructive states, focus treatments, and surface decoration still come
from the active theme.

To tune menu density or typography, set `--app-menu-font-size`,
`--app-menu-font-weight`, `--app-menu-icon-size`, or `--app-menu-row-height` in
your theme stylesheet. Use these shared variables rather than individual button
size overrides. Source-owned action popovers should put `or3-action-menu` on
their content wrapper; Nuxt dropdown menus receive it from app configuration.

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

`useButtonOverrides()` and `useInputOverrides()` are typed source helpers for
these bindings. Button variant/color/size and input variant/size keys follow the installed
Nuxt UI props and generated host config, including button `workspace`/`touch`/`modal`
sizes and `on-surface` color, and input `workspace` size and `modal` variant.
They preserve the same base-props-then-theme-props merge order.

`v-bind` changes Vue props. `v-theme` decorates the rendered DOM with owned
classes, styles, and annotations; it cannot mutate component props. Keep live
behavior such as disabled/loading explicit. Automatic directive context detection
recognizes only chat, sidebar, dashboard, and header. For other known contexts,
pass `context` explicitly to both the resolver and directive. An arbitrary
`data-context` wrapper alone does not enable detection. The directive supplies
`state: 'default'`; use CSS for actual hover/focus states.

Workspace source buttons in assistant messages use Nuxt UI and the reactive button
resolver. Target `button.message#message.workspace-source` for chat/document source
links and `button.message#message.workspace-sources-toggle` for Show all/Show fewer.
Their defaults use the compact `workspace` size, theme surface hover/active colors,
and focus tokens, with 44px touch targets and wrapping for long source titles.

Project Settings binds its Nuxt UI controls in the sidebar context. Theme overrides
can target `textarea#sidebar.project-settings.instructions` and `.repositories`,
`selectmenu#sidebar.project-settings.model`, `input#sidebar.project-settings.tool-search`,
`select#sidebar.project-settings.permission`, `switch#sidebar.project-settings.memory`,
and `button#sidebar.project-settings.save`, `.discard`, `.action`, or `.remove`.
The retro theme uses its surface, border, radius, control-height and elevation tokens
for these controls, tool category panels and the save footer.

Knowledge and Memory expose `sidebar.project-content.field` for native input,
textarea and select overrides, plus `button#sidebar.project-content.action`,
`.save`, `.source-menu-item` and `.memory-actions`. Their menus use
`popover#sidebar.project-content.source-menu` and
`dropdownmenu#sidebar.project-content.memory-menu`. Retro's panels and previews
use the existing surface, border, radius, elevation and typography tokens;
Blank retains the original fields, spacing and buttons, with Solar overrides.
Knowledge upload/document/file/attachment icons use
`sidebar.project.knowledge.upload`, `.document`, `.file` and `.saved-file`;
memory uses `sidebar.project.memory`. Defaults preserve the previous Lucide icons,
Retro supplies pixel icons, and Blank supplies Solar Linear icons with heavier strokes.

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

The Blank theme maps semantic tokens to Solar icons through
`app/theme/blank/icons.config.ts`. Its build-time `icon-collection.ts` selects
only the used Solar glyphs and increases Linear stroke widths from 1.5 to 2.05.
The `blank-solar` prefix keeps this change isolated from other themes. Bold
variants supply filled favorites, checked boxes, and stop/pause controls.
The sidebar's Chats, Documents, and Projects category badges use Bold Duotone
through `sidebar.category.chats`, `.documents`, and `.projects`, with softer
blue, green, and neutral circle backgrounds. Dedicated category tokens keep
list icons and navigation chevrons Linear; Retro retains its pixel badges.
Numbered H1/H2/H3 headings, explicit PDF marks, and offline servers retain Tabler
fallbacks because Solar lacks equivalent glyphs.

The host installs `@iconify-json/solar` and registers the subset with Nuxt Icon's
`customCollections`, including it in both the local server and client bundles so
it also works in static builds. Solar is by
[480 Design](https://www.figma.com/community/file/1166831539721848736), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); Blank modifies
the Linear stroke widths. Main rail icons render at 20px in 90% `onSurface` (`--blank-sb-icon`; full
`onSurface` on hover and for the active page) with 4px between 40px buttons;
touch layouts keep 24px.

Outside the sidebar, Blank keeps the same `--blank-sb-icon` tone: header actions
(split, theme, notifications) render at 18px, the tab strip's new-tab and close
controls at 16px, the sidebar search field's leading icon at 16px, and the
composer's attach and settings icons at 16px. Chat tabs use the same
`chat-square-line` glyph as sidebar rows. Mobile layouts keep their own larger
sizes.

Blank's sidebar chat and document row icons render at 16px in the same
90% `onSurface` (`--blank-sb-icon`) so titles carry the list; hover and
keyboard focus restore full `onSurface`, and active rows retain their primary
color. Row dates sit a step quieter at 60%. Section
headers use 12px sentence case, and an open section shows its arrow only on
hover or focus. On wide hover-capable screens rows are about 36px tall with
8px above each time section; touch layouts keep 48px rows.
Project rows use the same 16px icons, row "more" menus sit in
`onSurfaceVariant` until hovered or open, and section actions such as
"+ New" stay `onSurfaceVariant` until hovered. Branched chat groups show
`sidebar.chat.branched` in the icon column, and their `ui.chevron.right` /
`ui.chevron.down` disclosure replaces it on hover or focus. These rules belong
to Blank's stylesheet. Map only canonical Solar names: the subset builder
rejects Solar aliases such as `chat-line-linear`.

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
The collapsed sidebar Files button and Files tabs use `sidebar.page.files`; the retro theme overrides it with `pixelarticons:files`, Blank uses `blank-solar:documents-linear`, and the default is `i-lucide-files`.

The notification bell and its loading placeholder resolve `notification.bell`
through `useIcon()`, so Blank's Solar mapping also applies to workspace chrome.
Blank sizes desktop header icons, including the bell, uniformly at 20px for both
SVG and CSS-mask rendering.

Dashboard registrations and pages can supply an `iconToken` alongside their
fallback `icon`. The dashboard resolves that token through `AppIcon` at render
time, so switching themes updates existing cards. Workspaces uses
`dashboard.workspaces`, `.manage`, and `.backup`: their defaults preserve Retro's
pixel icons while Blank supplies Solar icons. Supplied app images still take
precedence. `useIcon()` accepts a token, ref, or getter for reactive token props.

The tab bar, tab switcher and mobile tab header resolve built-in content icons through `useWorkspaceTabIcon()` in component setup. Override `shell.tab.chat`, `shell.tab.document` and `shell.tab.app` for their fallback icons, and `shell.tab.close` for tab-bar close buttons. Blank supplies Solar icons; retro supplies pixel icons. Existing open tabs update when the theme changes. Supplied plugin icons and app images remain supported.

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
focus tokens while owning its geometry. In Blank, both the outer frame and header
divider use `--md-border-color`, so Theme studio’s **Colors → Borders** setting
updates them live in the selected light/dark mode. Sizes are `sm` (560px), `md` (700px),
`lg` (880px), and `workspace` (1280px with bounded height). Respect its scrolling
body, accessible title, close control, and footer. Shared headers use 20px vertical
and 24px horizontal padding, reduced to 16px in compact viewports, with a
theme-token divider across Blank, Retro and Cyberpunk. Do not replace geometry through
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


## Empty chat appearance

Enable `chatEmptyState` in the theme definition, or set it to `false` to opt out. Blank is the only bundled theme that enables it. Copy, assets, action order, and color-mode overrides are documented in the [theme reference](/documentation/themes/api-reference#empty-chat-panes).

Use these stable hooks in a theme-local stylesheet scoped to your theme:

```css
html[data-theme='my-theme'] .chat-empty-hero { max-width: 320px; }
html[data-theme='my-theme'] .chat-empty-accent { right: 8%; width: 24%; }
html[data-theme='my-theme'] .chat-empty-heading { font-size: 2rem; }
html[data-theme='my-theme'] .chat-empty-action { border-radius: 12px; }
```

Other hooks: `.chat-container--empty`, `.chat-empty-background`, `.chat-empty-state`, `.chat-empty-artwork`, `.chat-empty-description`, `.chat-empty-actions`, `.chat-empty-action-icon`, `.chat-empty-action-label`, `.chat-empty-action-description`, and `.chat-empty-action-chevron`. Each action has `data-empty-chat-action="start-chat|start-project|create-document"`. The presenter exposes `data-layout="cards|compact|stacked"`.

Reactive prop overrides are available at `section#chat.empty-state` and `button#chat.empty.start-chat`, `button#chat.empty.start-project`, `button#chat.empty.create-document`, all in the `chat` context. Shared creation dialogs expose `modal#chat.empty.create`. Preserve labeled keyboard actions, visible focus, 44px touch targets, and container queries that keep the composer usable in narrow or short panes. The default illustration is static, including with reduced motion enabled.

The supplied Blank hero already includes its speech bubble, so its separate accent is disabled. Alternate themes may use independent hero/accent images and position them through their own CSS. The empty-state background is local to the pane; use the existing global background slots for artwork intended to remain behind populated chats too.

Blank feathers the background with an elliptical CSS opacity mask and fades only the bottom of its hero cloud. Adjust or override `mask-image` / `-webkit-mask-image` on `.chat-empty-background` and `.chat-empty-hero` to change the blend. These masks affect decoration only, in both color modes; exported assets retain their alpha.

On phone viewports, Blank’s `cards` layout groups the three actions into a rounded panel with visible descriptions, circular icons, and trailing chevrons. The artwork and spacing scale with available pane height; short screens retain a compact layout so the composer stays reachable. These rules are limited to viewports up to 767px and leave the desktop layout unchanged. Other themes and authored `compact`/`stacked` layouts retain their own presentation.
