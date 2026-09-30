# Build your first theme

Create a small declarative theme with light and dark colors. Its installable
package needs two JSON files and no TypeScript, image, stylesheet, or Vue file.
Use an OR3 source checkout with dependencies installed for the local preview.
Installing through Admin requires an SSR deployment and administrator access.

## 1. Create the package files

Create a new folder named `ocean-theme` outside `app/theme/`. Add these files.

`or3.manifest.json`:

```json
{
  "kind": "theme",
  "id": "ocean-theme",
  "name": "Ocean",
  "version": "1.0.0",
  "description": "A small blue theme with light and dark palettes.",
  "capabilities": [],
  "themeTrust": "declarative"
}
```

`or3.theme.json`:

```json
{
  "name": "ocean-theme",
  "displayName": "Ocean",
  "description": "A small blue theme with light and dark palettes.",
  "colors": {
    "primary": "#086db8",
    "onPrimary": "#ffffff",
    "secondary": "#176b62",
    "onSecondary": "#ffffff",
    "surface": "#f5f9fc",
    "onSurface": "#142638",
    "outline": "#63798c",
    "dark": {
      "primary": "#81c9ff",
      "onPrimary": "#003353",
      "secondary": "#80d5c8",
      "onSecondary": "#003831",
      "surface": "#101c27",
      "onSurface": "#e1edf6",
      "outline": "#92a9bb"
    }
  },
  "borderWidth": "1px",
  "borderRadius": "8px"
}
```

Keep the definition `name` equal to the manifest `id`. Use a unique lowercase
kebab-case ID that does not collide with a built-in/source theme. Required colors
are `primary`, `secondary`, and `surface`. Dark entries override the light
palette; omitted entries inherit. Define matching foregrounds explicitly for
important roles and check their contrast.

## 2. Preview in a source checkout

Discovery reads `app/theme/<directory>/theme.ts`, not arbitrary JSON folders.
For a local preview only, create `app/theme/ocean-theme/`, copy `or3.theme.json`
there, and add this `theme.ts` adapter:

```ts
import definition from './or3.theme.json';
import { defineTheme } from '../_shared/define-theme';

export default defineTheme(definition);
```

From the checkout root:

```sh
bun run theme:validate ocean-theme
bun run dev
```

The validator checks configuration and regenerates theme metadata/types. It is
not a full TypeScript check. Open **Dashboard → Theme** and select **Ocean**.
If the dev server was already running, restart it if the new folder is not
shown. Do not use `theme:switch` to change your current browser selection: that
command edits the deployment's `.env` default.

Keep the original package folder separate. Its declarative ZIP must not contain
the preview adapter's `theme.ts`. If you install the ZIP into this same checkout
later, first remove your preview folder; an unmanaged source folder with that
ID conflicts with the installer.

## 3. Verify the appearance

1. Disable personal style overrides in Theme studio so you see the authored
   theme. Select Ocean and check chat, sidebar, inputs, and a dialog.
2. Switch light/dark mode. Confirm text, buttons, borders, and focus indicators
   are readable in both.
3. Select another theme, then return to Ocean. Confirm the palette updates
   without leftover styling.
4. Reload. Confirm Ocean remains selected and the first render is consistent.
5. Use a narrow browser viewport and keyboard navigation. Check touch controls,
   visible focus, readable text, and dialog scrolling.

Retain screenshots of the same surfaces in both modes, before and after reload,
and record the theme ID/version and host revision. Repeat those steps after
installation of the ZIP; a valid configuration alone does not prove the UI works.

## 4. Extend and distribute

Add icons, control recipes, or a local stylesheet with
[Style your theme](/documentation/themes/styling). Only declare a stylesheet
or image after creating its actual file. Follow
[Package and install](/documentation/themes/package-install) to ZIP and install
the original two-file package.

For TypeScript helpers or Vue replacements, start a separate trusted source
theme with `bun run theme:create my-trusted-theme` and follow
[Replace app components](/documentation/themes/component-overrides). The
scaffold is not the declarative package format.
