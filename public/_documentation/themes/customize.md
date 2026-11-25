# Customize your appearance

Open **Dashboard → Theme** to use Theme studio. Changes apply live; you do not
need an administrator or a theme package to customize your own appearance.

## Start with a theme

In **Theme**, choose an available theme and a light/dark mode. These are separate
choices: Retro can be light or dark. A disabled or undiscovered theme cannot be
selected. Administrator installation is covered in
[Package and install](/documentation/themes/package-install).

## Save and switch themes

On the **Theme** tab, choose **Save current theme**, enter a name, and select
**Save**. The preset captures the installed base theme and your customizations
for both light and dark mode. Saving with the name of an existing preset
replaces that preset.

Select a saved theme's card to apply it. Applying replaces both sets of active
customizations and keeps the current light or dark mode; save your current look
first if you want to switch back to it later. The card whose preset matches
your current look is marked **Active**. Each card's menu can update the preset
with your current look, rename it, or delete it; a deletion can be undone from
the notice that follows. Background images appear on devices that have the
referenced workspace files.

## Customize one area

| Section | What it changes |
| --- | --- |
| Colors | Accent, surfaces, text, borders, interaction states, and status colors; additional roles live under Advanced colors |
| Typography | Body and heading font choices, including the authored theme font; base font size is bounded to 14–24px; interface scale (Theme default, 80–120%) resizes the app and leaves message and document text at its own size |
| Shape | Divider/component/emphasis border widths and small/standard/large radii; density and elevation presets |
| Backgrounds | Workspace base, workspace overlay, and sidebar layers, with image/layout/opacity controls |
| Advanced | Focus-ring thickness, motion preference, and reset controls |

Choose the area or color role, then edit it in the inspector. Check the actual
chat, sidebar, and dialogs as well as the preview. Keep foreground/background
pairs readable. The color editor pairs high-impact roles, but a custom palette
still needs checks in both modes.

In **Colors**, use **Color token** to choose the color you want to edit. Each
option shows a swatch of its current color. A short description below the picker
shows where each color is used, including advanced colors. Switch between the
sample chat and document in **Live preview**. Open either item's
**⋯** menu and choose **Rename** to preview the sidebar's rename dialog.
**Menu & dialog background** changes the open dialog and sidebar action menus.
**App background** also colors the document toolbar. Under **Show advanced
colors**, choose **Surface container lowest** to color the Files table header,
**Dialog backdrop** to change the tint and opacity behind the dialog, or
**Keyboard focus ring** to customize the outline you see when tabbing between
controls. With advanced colors shown, edits apply
to the selected token only. You can edit colors with the dialog open.
Renaming changes only the sample title for the current preview.

You can also ask a tool-capable chat to change colors, typography, borders,
corner radii, or color mode when its **Appearance** tools are enabled.
The AI sees the same one-sentence descriptions shown next to those controls.
See [Appearance tools](/documentation/utils/chat-tools#appearance-tools).

Style groups have their own enable switches. Disabling a group restores the
active theme's authored values without discarding its saved customizations.
Selecting **Theme default** for a preset restores the authored tokens and local
component fallbacks. Light and dark customizations are separate: switch mode
before editing the other palette. Personal overrides also sit above a newly
selected theme, so disable them when comparing themes' original appearance.

Focus thickness is 1–4px and applies to both modes. **Reduced** motion and the
operating system's reduced-motion preference suppress decorative motion while
preserving visible status information. CSS state changes apply immediately,
including live typography changes, instead of animating every affected element.
These are global accessibility choices, not per-theme light/dark presets.

## Readable chat over backgrounds

In Colors, **Chat → Assistant messages** puts a panel behind assistant replies so
they stay readable over a background image. It is off until you pick a color.
**Opacity** sets how solid the panel is (stored in the color's alpha channel, as
`#RRGGBBAA`). **Blur behind** blurs the image behind the panel; it can make
scrolling slow on some devices, so it is off by default. Your choice overrides
themes that keep replies transparent. User messages and tool cards follow the
existing **Hover surface** (Blank theme bubbles) and **Panel background** colors.

## Message buttons

In Backgrounds, **Message buttons** has two switches, saved per light and dark
mode like other Appearance choices: **Inside your messages** keeps copy, retry,
branch, and edit inside your message bubble, and **Inside assistant replies**
keeps the reply buttons inside the reply instead of on its bottom edge. Both
are off by default. Buttons placed inside a message stay visible, including in
themes that otherwise reveal them on hover (Retro on desktop). Retro and
Cyberpunk show inside buttons as a quiet footer (plain icons under a divider)
at every width instead of boxed buttons.

## Background images

In Backgrounds, select one area and use its inspector to choose an image,
layout, opacity, pattern size, and base color. **Choose image…** opens a picker
for that area with the workspace's images, newest first, including images sent
in chat. Search filters by file name; the first tile uploads a new image.
Clicking or dropping on the preview still uploads directly. Uploads accept PNG, JPEG, WebP,
or GIF up to 8 MiB. HEIC/HEIF photos must be exported as JPEG or PNG first.
Validation uses file signatures, so a valid image with an empty browser MIME
type still works. Rejected uploads show a Background image not applied toast.

Uploaded bytes are stored in the active browser database and referenced by an
`internal-file://<hash>` token. A runtime object URL is temporary and must not
be saved as the preference. Personal background choices remain above newly
selected theme defaults; disable the Backgrounds group to view the authored
appearance without discarding your saved choices.

## What gets saved

| Choice | Current persistence |
| --- | --- |
| Selected theme | `theme_selection` in the active workspace's Dexie KV database; eligible for its configured sync |
| First SSR theme paint | `or3_active_theme` browser cookie, checked against discovered themes |
| Light/dark mode | Browser `localStorage['theme']` |
| Personal style overrides | Browser localStorage, separately for light and dark |
| Saved themes | One `theme-preset:<id>` KV record per preset in the active workspace, eligible for its configured sync |
| Focus width and motion | Browser localStorage, shared across modes |

Personal style and accessibility overrides are not currently an account-synced
preference repository. They are browser-local. Switching workspaces can change
the selected theme while those browser-local overrides remain. Clearing browser
storage can remove them. See [Runtime and architecture](/documentation/themes/architecture#persistence)
for the exact keys.

## Check and reset

1. Customize a color in light mode, then switch to dark and confirm its values
   remain separate.
2. Reload and confirm your theme and customizations return.
3. Disable the customized group and confirm the authored appearance returns;
   re-enable it to confirm the saved values remain.
4. Use the reset controls in Advanced when you want to discard customizations.
   Resetting personal appearance does not uninstall the selected theme.

If a change disappears or seems ineffective, use
[Troubleshooting](/documentation/themes/troubleshooting). To share a reusable
appearance, [build a theme](/documentation/themes/first-theme); personal
customizations are not automatically a distributable theme package.
