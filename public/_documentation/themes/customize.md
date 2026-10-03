# Customize your appearance

Open **Dashboard → Theme** to use Theme studio. Changes apply live; you do not
need an administrator or a theme package to customize your own appearance.

## Start with a theme

In **Theme**, choose an available theme and a light/dark mode. These are separate
choices: Retro can be light or dark. A disabled or undiscovered theme cannot be
selected. Administrator installation is covered in
[Package and install](/documentation/themes/package-install).

## Customize one area

| Section | What it changes |
| --- | --- |
| Colors | Accent, surfaces, text, borders, interaction states, and status colors; additional roles live under Advanced colors |
| Typography | Body and heading font choices, including the authored theme font; base font size is bounded to 14–24px |
| Shape | Divider/component/emphasis border widths and small/standard/large radii; density and elevation presets |
| Backgrounds | Workspace base, workspace overlay, and sidebar layers, with image/layout/opacity controls |
| Advanced | Focus-ring thickness, motion preference, and reset controls |

Choose the area or color role, then edit it in the inspector. Check the actual
chat, sidebar, and dialogs as well as the preview. Keep foreground/background
pairs readable. The color editor pairs high-impact roles, but a custom palette
still needs checks in both modes.

Style groups have their own enable switches. Disabling a group restores the
active theme's authored values without discarding its saved customizations.
Selecting **Theme default** for a preset restores the authored tokens and local
component fallbacks. Light and dark customizations are separate: switch mode
before editing the other palette. Personal overrides also sit above a newly
selected theme, so disable them when comparing themes' original appearance.

Focus thickness is 1–4px and applies to both modes. **Reduced** motion and the
operating system's reduced-motion preference suppress decorative motion while
preserving visible status information. These are global accessibility choices,
not per-theme light/dark presets.

## Background images

In Backgrounds, select one area and use its inspector to choose an image,
layout, opacity, pattern size, and base color. Uploads accept PNG, JPEG, WebP,
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
