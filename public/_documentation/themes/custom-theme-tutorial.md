# Tutorial: Build, Package & Install a Custom Theme

This tutorial walks you through creating a fully-featured OR3 theme from scratch,
packaging it as a ZIP, and installing it via the admin panel. We'll use the
**Cyberpunk** theme (already in the repo) as our working reference so every
step has a real-world anchor.

---

## Prerequisites

- OR3 dev environment running (`bun run dev`)
- Basic CSS/TypeScript familiarity
- A text editor

---

## Part 1 — Scaffold the theme

Run the scaffold CLI. Replace `ocean-dark` with your theme's kebab-case id:

```bash
bun run theme:create
```

The CLI creates:

```
app/theme/ocean-dark/
  theme.ts
  README.md
```

You can add the rest of the files manually as you work through this tutorial.
The final structure for a fully-featured theme looks like this:

```
app/theme/ocean-dark/
  theme.ts              ← required — color palette, fonts, overrides
  or3.manifest.json     ← required for ZIP install
  app.config.ts         ← optional — Nuxt UI slot/variant patches
  icons.config.ts       ← optional — semantic icon overrides
  styles.css            ← optional — scoped CSS for third-party/legacy DOM
  assets/
    banner.png          ← optional — background images, logos, etc.
  styles/
    sidebar.ts          ← optional — split large override maps
    chat.ts
    dashboard.ts
```

---

## Part 2 — Define the theme

`theme.ts` is the heart of your theme. Everything flows from here.

```ts
// app/theme/ocean-dark/theme.ts
import { defineTheme } from '~/theme/_shared/define-theme';

// Optional: pre-resolve asset URLs (works in Vite dev + production builds)
const bannerUrl = new URL('./assets/banner.png', import.meta.url).href;

export default defineTheme({
  name: 'ocean-dark',
  displayName: 'Ocean Dark',
  description: 'Deep-sea blues with bioluminescent accents',
  isDefault: false,

  // Tell the theme system to inject this CSS file
  stylesheets: ['./styles.css'],

  // Border style — cyberpunk uses 1px sharp, retro uses 2px
  borderWidth: '1px',
  borderRadius: '4px',

  // ── Color palette ────────────────────────────────────────────────────────
  // Required: primary, secondary, surface
  // Recommended: onPrimary, onSecondary, onSurface, and their hover/active
  // Dark-mode overrides live under the `dark` key
  colors: {
    primary: '#0ea5e9',
    primaryTint: '#38bdf8',
    primaryShade: '#0284c7',
    onPrimary: '#ffffff',
    primaryContainer: '#0c4a6e',
    onPrimaryContainer: '#e0f2fe',
    primaryBorder: '#0284c7',
    primaryHover: '#38bdf8',
    primaryActive: '#0284c7',

    secondary: '#06b6d4',
    onSecondary: '#ffffff',
    secondaryContainer: '#164e63',
    onSecondaryContainer: '#cffafe',

    tertiary: '#818cf8',
    onTertiary: '#1e1b4b',

    surface: '#e0eaf4',
    surfaceHover: '#c9d8ec',
    surfaceActive: '#b0c4de',
    surfaceContainerLowest: '#ecf3fa',
    onSurface: '#0a1628',
    surfaceVariant: '#b4c9de',
    onSurfaceVariant: '#1e3a5a',
    inverseSurface: '#0d1b2e',
    inverseOnSurface: '#d0e4f8',

    outline: '#3a6080',
    borderColor: '#0284c7',

    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#bae6fd',
    infoHover: '#a0d4f5',
    infoActive: '#86c0ec',
    onInfo: '#0c2a42',
    topHeaderBg: '#c4d8ec',

    dark: {
      primary: '#38bdf8',
      primaryTint: '#7dd3fc',
      primaryShade: '#0ea5e9',
      onPrimary: '#001f33',
      primaryContainer: '#013a5c',
      onPrimaryContainer: '#b9e5ff',
      primaryBorder: '#0ea5e9',
      primaryHover: '#7dd3fc',
      primaryActive: '#38bdf8',

      secondary: '#22d3ee',
      onSecondary: '#00232b',
      secondaryContainer: '#003d4d',
      onSecondaryContainer: '#a5f3fc',

      tertiary: '#a5b4fc',
      onTertiary: '#1e1b4b',

      surface: '#0d1b2e',
      surfaceHover: '#152538',
      surfaceActive: '#1e3040',
      surfaceContainerLowest: '#08111f',
      onSurface: '#d0e8ff',
      surfaceVariant: '#1e3a5a',
      onSurfaceVariant: '#90b8d8',
      inverseSurface: '#d4e8f8',
      inverseOnSurface: '#0d1b2e',

      outline: '#4a7090',
      borderColor: '#0ea5e9',

      info: '#0c2a42',
      infoHover: '#0e3050',
      infoActive: '#103858',
      onInfo: '#bae6fd',
      topHeaderBg: '#0d1b2e',
    },
  },

  // ── Typography ───────────────────────────────────────────────────────────
  fonts: {
    sans: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    heading: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
    baseSize: '15px',
  },

  // ── Background images ────────────────────────────────────────────────────
  backgrounds: {
    content: {
      base: { image: bannerUrl, opacity: 0.04, size: 'cover', position: 'center' },
    },
    sidebar: {
      image: bannerUrl, opacity: 0.06, size: 'cover', position: 'center top',
    },
  },

  // ── Component overrides ──────────────────────────────────────────────────
  // Selector syntax: 'component[.context][#identifier]'
  // See api-reference.md for the full context list
  overrides: {
    // Chat input send button
    'button#chat.send': {
      variant: 'solid',
      color: 'primary',
      class: 'theme-btn flex items-center justify-center',
    },
    // User message bubble
    'div#message.user-container': {
      class: 'bg-[var(--md-primary-container)]! text-[var(--md-on-primary-container)]!',
    },
    // Sidebar new-chat button
    'button#sidebar.new-chat': {
      variant: 'solid',
      color: 'primary',
    },
    // Chat input area
    'div#chat.input-main-container': {
      class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus-within:border-[color:var(--md-primary)] focus-within:ring-1 focus-within:ring-[color:var(--md-primary)]',
    },
  },
});
```

> **Tip — cyberpunk reference**: Compare this against
> `app/theme/cyberpunk/theme.ts`. The cyberpunk theme splits its large
> `overrides` map into `styles/sidebar.ts`, `styles/chat.ts`, etc., and
> imports them. Do the same once your overrides file gets unwieldy.

---

## Part 3 — Add icon overrides (optional)

Create `icons.config.ts` to swap the default icon set. The cyberpunk theme
uses IBM Carbon icons for a techy look:

```ts
// app/theme/ocean-dark/icons.config.ts
import type { IconMap } from '~/theme/_shared/icon-registry';

export default <IconMap>{
  'chat.send': 'carbon:send-alt',
  'chat.stop': 'carbon:stop-filled',
  'chat.attach': 'carbon:add',
  'sidebar.search': 'carbon:search',
  'sidebar.new_chat': 'carbon:chat',
  'sidebar.new_folder': 'carbon:folder-add',
  'ui.close': 'carbon:close',
  'ui.copy': 'carbon:copy',
  'ui.trash': 'carbon:trash-can',
  'ui.edit': 'carbon:edit',
  'ui.settings': 'carbon:settings-adjust',
  'shell.theme.light': 'carbon:light',
  'shell.theme.dark': 'carbon:asleep',
};
```

See `app/theme/cyberpunk/icons.config.ts` for the full set of available
token names.

---

## Part 4 — Patch Nuxt UI slots (optional)

Create `app.config.ts` to override Nuxt UI component slots. This is how the
cyberpunk theme applies its monospace modal headers and border-aware tooltips:

```ts
// app/theme/ocean-dark/app.config.ts
export default {
  ui: {
    tooltip: {
      slots: {
        content:
          'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]! ring-0 rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[var(--md-on-surface)] shadow-lg h-[36px] px-3 text-sm',
      },
    },
    modal: {
      slots: {
        overlay: 'fixed inset-0 bg-black/60 backdrop-blur-sm dark:bg-black/80',
        content:
          'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] ring-0 fixed divide-y divide-default flex flex-col focus:outline-none',
        header:
          'relative border-none bg-primary px-2! sm:px-3! py-0 sm:p-0 min-h-[44px] w-full justify-between flex items-center text-[var(--md-on-primary)]!',
        title: 'text-[var(--md-on-primary)] font-semibold text-base!',
        description: 'hidden',
        close: 'relative! top-auto! end-auto! flex items-center justify-center',
      },
    },
  },
};
```

> **Important**: `app.config.ts` patches are merged into the global app config
> when your theme is active. Be surgical — only override what you need.
> Overriding entire component configs can break other components.

---

## Part 5 — Add scoped CSS (optional)

Use `styles.css` for anything that can't be expressed through the overrides
system — third-party widgets, legacy DOM, or complex selectors. All rules
**must** be scoped to `[data-theme="ocean-dark"]` to prevent leaking.

```css
/* app/theme/ocean-dark/styles.css */

/* Scoped borders on multi-pane layout */
[data-theme="ocean-dark"] .chat-container:not(:last-child) {
  border-right: var(--md-border-width) solid var(--md-border-color);
}

[data-theme="ocean-dark"] #app-sidebar {
  border-right: var(--md-border-width) solid var(--md-border-color);
}

/* Tool call blocks */
[data-theme="ocean-dark"] .tool-call-indicator {
  border-radius: var(--md-border-radius);
  border: var(--md-border-width) solid var(--md-border-color);
  overflow: hidden;
  margin-top: 8px;
  margin-bottom: 8px;
}

[data-theme="ocean-dark"] .retro-tool-call-content {
  background-color: var(--md-surface) !important;
  border: none !important;
  border-radius: var(--md-border-radius) !important;
  font-family: "IBM Plex Mono", monospace !important;
  font-size: 12px !important;
  padding: 12px !important;
}
```

Reference the cyberpunk theme's `/public/themes/cyberpunk.css` and
`app/theme/cyberpunk/styles.css` for a complete real-world example.

After writing your CSS, declare the stylesheet in `theme.ts`:

```ts
stylesheets: ['./styles.css'],
```

---

## Part 6 — Validate and build

**Validate** the theme definition (catches type errors, missing required
colors, and generates `types/theme-generated.d.ts`):

```bash
bun run theme:validate ocean-dark
```

**Build** the public CSS file from `cssSelectors.style` entries (only needed
if you use `cssSelectors` with `style` objects instead of a raw CSS file):

```bash
bun run theme:build-css
```

**Switch** to your theme to test in the browser:

```bash
bun run theme:switch
```

Or switch at runtime in the app via Settings → Theme.

---

## Part 7 — Create the manifest

The manifest is required for ZIP installation. Create it at the theme root:

```json
// app/theme/ocean-dark/or3.manifest.json
{
  "kind": "theme",
  "id": "ocean-dark",
  "name": "Ocean Dark",
  "version": "1.0.0",
  "description": "Deep-sea blues with bioluminescent accents",
  "capabilities": [],
  "themeTrust": "trusted-code",
  "componentContractVersion": 1
}
```

Rules:
- `id` must be **kebab-case**, no spaces, no path separators.
- `id` must **not** collide with a built-in theme (`blank`, `retro`, `cyberpunk`). If it does, install will fail with a conflict error.
- `kind` must be `"theme"`.
- SemVer is recommended for `version`. Legacy V1 manifests currently accept any
  non-empty version string; Manifest V2 enforces semantic versions.
- This tutorial authors `theme.ts`, so it uses `trusted-code`. Prefer the
  declarative tier and `or3.theme.json` when no code or Vue replacements are
  needed.
- For **trusted-code** themes, the definition `name` no longer needs to match
  the manifest `id`: the compiler tracks the installed source directory
  separately. Keeping them equal is still recommended for clarity.
  **Declarative** themes (`themeTrust: "declarative"`) are stricter: the
  `name` in `or3.theme.json` must match the manifest `id` or install fails.

---

## Part 8 — Package as ZIP

A theme ZIP contains your theme folder and one `or3.manifest.json`. A flat
archive with the manifest at the ZIP root is recommended. The installer also
accepts an enclosing source/archive directory (such as GitHub-generated ZIPs)
and strips the directory prefix during installation.

```bash
# From your repo root
cd app/theme/ocean-dark
zip -r ../../../ocean-dark-v1.0.0.zip . -x "*.DS_Store" -x "__MACOSX/*"
```

Or with Bun:

```ts
// scripts/pack-theme.ts — run with: bun scripts/pack-theme.ts ocean-dark
import { $ } from 'bun';
const id = process.argv[2];
if (!id) throw new Error('Usage: bun scripts/pack-theme.ts <theme-id>');
await $`cd app/theme/${id} && zip -r ../../../${id}-v1.0.0.zip . -x "*.DS_Store" -x "__MACOSX/*"`;
console.log(`Packaged → ${id}-v1.0.0.zip`);
```

**Recommended ZIP structure**:

```
ocean-dark-v1.0.0.zip
  or3.manifest.json        ← must be at root
  theme.ts
  app.config.ts
  icons.config.ts
  styles.css
  assets/
    banner.png
  styles/
    chat.ts
    sidebar.ts
```

> **Size limit**: Default max ZIP size is **25 MB** (`OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES`).
> Max file count is **2000**. Max unpacked size is **200 MB**.
> Allowed extensions: `.ts`, `.vue`, `.js`, `.css`, `.json`, `.png`, `.svg`, `.woff2`, etc.

---

## Part 9 — Install via admin panel

There are two ways to install from the admin panel:

### Option A — Upload a .zip file

1. Open the admin panel → **Themes** page.
2. Click **Install .zip**.
3. Upload your `ocean-dark-v1.0.0.zip`.
4. The server extracts the ZIP, validates the manifest, writes to
   `extensions/themes/ocean-dark/`, and symlinks it into `app/theme/ocean-dark/`.
5. **Restart the dev server** for the new theme to be discovered by
   `import.meta.glob`. In production, rebuild/redeploy and restart; restarting
   an unchanged bundle cannot add a build-time-discovered theme module.
6. After restart, select **Ocean Dark** in Settings → Theme.

### Option B — Import from URL

1. Open the admin panel → **Themes** page.
2. Click **Import from URL**.
3. Paste a direct HTTPS link to a `.zip` archive. GitHub archive URLs work:
   ```
   https://github.com/user/repo/archive/refs/heads/main.zip
   ```
4. Click **Install**. The server fetches the ZIP over HTTPS, rejects
   private/reserved addresses, and pins each connection to the public DNS answer
   validated for that redirect hop before running the install pipeline.
5. **Restart** as described above.

> **URL requirements**: Only HTTPS URLs are accepted. The server blocks requests
> to private/reserved IP ranges, validates DNS resolution, and enforces the same
> 25 MB size limit. Redirects are followed (up to 5 hops) with per-hop validation.

### Installing via API (curl)

**Multipart file upload:**

```bash
curl -X POST https://your-or3-instance.com/api/admin/extensions/install \
  -H "Cookie: <admin-session-cookie>" \
  -F "file=@ocean-dark-v1.0.0.zip" \
  -F "expectedKind=theme" \
  -F "force=false"
```

Pass `force=true` to overwrite an existing version:

```bash
-F "force=true"
```

**URL-based install:**

```bash
curl -X POST https://your-or3-instance.com/api/admin/extensions/install \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -d '{"url": "https://github.com/user/repo/archive/refs/heads/main.zip", "expectedKind": "theme", "force": false}'
```

### Installing via Base64 JSON body

```bash
curl -X POST https://your-or3-instance.com/api/admin/extensions/install \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -d "{\"zipBase64\": \"$(base64 -i ocean-dark-v1.0.0.zip)\", \"expectedKind\": \"theme\", \"force\": false}"
```

### Theme trust tiers

Use `"themeTrust": "declarative"` for installable visual themes. These packages
provide `or3.theme.json`; executable JS/TS/Vue and CSS preprocessors are rejected,
the definition is schema-validated, and OR3 generates the runtime module.

Use `"themeTrust": "trusted-code"` only when the theme requires TypeScript,
Vue component replacements, or app-config code. Installing that tier is
equivalent to installing application code and should only be done from a source
you trust. Legacy theme packages without `themeTrust` are treated as trusted
code for compatibility.

---

## Part 10 — Uninstall

In the admin panel → **Themes**, click **Uninstall** on any installed
extension theme. Built-in themes (blank, retro, cyberpunk) do not show an
Uninstall button — remove them from the repo directly. Rebuild/redeploy a
production bundle after uninstall so it no longer contains the removed module.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Theme not appearing after install | Dev server not restarted, or production bundle not rebuilt | Restart development; rebuild/redeploy production |
| `"conflicts with a built-in theme directory"` | Your `id` matches a built-in | Rename your theme |
| `"Invalid manifest"` | Missing `kind`, `id`, or `name` in manifest | Check `or3.manifest.json` |
| `"Invalid archive path"` | Path traversal (`..`) in ZIP | Re-zip cleanly: `zip -r . -x "*.DS_Store"` |
| Colors look wrong in light mode | Missing top-level (non-dark) palette entries | Ensure light-mode colors are defined outside `dark: {}` |
| Overrides not applying | Identifier mismatch | Check with browser devtools: look for `data-v-theme` on the element |
| Styles leaking into other themes | CSS not scoped | Prefix all rules with `[data-theme="your-id"]` |

---

## Reference: cyberpunk theme files

Use these as your copy-paste starting points:

| Folder | What to learn from it |
|---|---|
| `app/theme/blank` | Complete barebone theme to use as a blank canvas |
| `app/theme/retro` | Complete retro theme with more detail good for learning advanced styling |
