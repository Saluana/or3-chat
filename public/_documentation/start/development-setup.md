# Development Environment Setup

One command gets a source checkout running locally. No API key or `.env` file
is required for the local-first app.

---

## 1. Prerequisites

You need only:

- **Node.js 24+**. Verify with `node -v`.
- **Git** to clone the repository.
- A modern browser.

**Bun** is the repository's canonical package manager (the project pins
`bun@1.3.14` in `package.json`). Install it from [bun.sh](https://bun.sh) and
verify with `bun -v`. The npm/npx equivalents still work, but the commands
below use Bun.

---

## 2. Clone the repository

```bash
# Fork the repo first if you plan on contributing
git clone https://github.com/Saluana/or3-chat.git
cd or3-chat

# (Optional) add upstream remote for syncing later
git remote add upstream https://github.com/Saluana/or3-chat.git
```

The project expects the working directory to remain `or3-chat/`. Nuxt uses `app/` as the `srcDir`, so you will find pages, layouts, and components there.

---

## 3. Start OR3

Install dependencies once, then start the dev server:

```bash
bun install
bun run dev
```

`bun run dev` runs `scripts/cli/dev.ts`, a wrapper around `nuxt dev`. It checks
that the target port (3000 by default) is free on both IPv4 and IPv6 loopback
before starting. If another OR3 or Nuxt server is already running there, it
explains the conflict and offers the next free port instead of silently
starting a second broken server.

Local-first mode needs no account or `.env` file. It stores data in the
browser. Connect OpenRouter from the in-app onboarding when you are ready.

Other dev modes:

```bash
bun run dev:ssr     # SSR auth on (cloud mode), 127.0.0.1:3000
bun run dev:offline # all cloud features off, pure local-first session
```

### Managed Cloud (no source checkout)

The supported way to run a Cloud deployment is the small `@or3/cloud` operator
package, which uses the version-matched OR3 image and needs no source checkout
or manually entered environment variables:

```bash
npx @or3/cloud init --local
```

For a public VPS behind Caddy:

```bash
npx @or3/cloud init --public --domain chat.example.com
```

See `docs/start-here.md` in the repository root for the full path comparison.

> **Note:** The older `npm start` / `bun start` entry point
> (`scripts/cli/start.mjs`) still works and installs dependencies on first
> run, but it is a legacy convenience for source checkouts. It is not the
> beginner or release path.

---

## 4. Optional developer configuration

You only need `.env` values when developing a specific integration. For
example, an OpenRouter API key can be supplied to test server-side behavior:

Edit `.env` (git-ignored) and set at least:

```ini
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxx
```

These are optional for normal local development. Restart the dev server after
changing environment files so Nuxt picks them up.

---

## 5. Dev server flags

-   Nuxt serves the app at **http://localhost:3000/** by default.
-   Pass extra flags after `--` (e.g., `bun run dev -- --https --open`).
-   Expect warm-up time on first boot while Nuxt generates `.nuxt/` and Vite builds chunks.

---

## 6. Tailwind 4 + design system notes

Tailwind v4 is configured via `app/assets/css/main.css`:

```css
@import 'tailwindcss';
@plugin "@tailwindcss/typography";
@import '@nuxt/ui';
```

-   Utility scanning relies on the `@source` directive that already targets `app.config.ts` and the `app/` directory.
-   To add custom utilities, extend `app/assets/css/theme.css` (or another stylesheet imported from `main.css`).
-   Tailwind tokens pull fonts from Nuxt Fonts (`Press Start 2P`, `VT323`). `@nuxt/ui` is layered above Tailwind, then mapped to the retro theme in `nuxt-ui-map.css`.

When you add new components, Tailwind picks up classes instantly through Vite HMR—no config reloads necessary.

---

## 7. Useful developer workflows

### Run unit tests (Vitest + jsdom)

```bash
bun run test       # one-off
bun run test:watch # watch mode with UI prompts
```

### Build static output (for smoke testing deployment)

```bash
bun run build
bun run preview    # serves the built output on port 3000 by default

# Static pre-render suitable for GitHub Pages / static hosting
bun run generate
```

### Inspect and reset local data

-   Use your browser DevTools → **Application** → **IndexedDB** → `or3-db` to view Dexie tables.
-   Delete the `or3-db` database or clear site data to reset threads, docs, and cached files.
-   Run `localStorage.clear()` in the console to remove cached preferences (model selection, theme settings, etc.).

---

## 8. Debugging tips

-   **Nuxt DevTools** → Components tab shows reactive state, props, and emitted events. Use the Graph tab to inspect route params and runtime config.
-   **Network throttling**: Test streaming behavior by enabling Slow 3G in browser DevTools. The chat UI renders incremental tokens from the OpenRouter stream helper.
-   **Console logging**: leverage OR3's `~/utils/errors.ts` helpers (`reportError` with `{ toast: true }`, `err`) for structured logs and toast integration.
-   **Dexie debugging**: install the [Dexie Inspector](https://chromewebstore.google.com/detail/dexie-inspector/dhgnppuogchnjdlacomooganmphadamk) for richer IndexedDB views.
-   **VS Code launch config**: attach to the Vite server by adding a "Chrome" debug profile pointing at `http://localhost:3000`. Source maps resolve back to files in `app/` thanks to Nuxt 4 + Vite.
-   **Hot module quirks**: if Nuxt HMR gets stuck, stop the dev server, delete `.nuxt/` and `node_modules/.vite`, then rerun `bun run dev`.

---

## 9. Keeping dependencies up to date

-   Upgrade Nuxt/Tailwind by running `bun x nuxi upgrade` or editing `package.json`, then `bun install`.
-   Regenerate type imports after dependency changes:

```bash
bun x nuxi cleanup
bun x nuxi prepare
```

-   Commit the updated `bun.lock` so teammates pull the same versions.

---

## 10. Common issues & fixes

| Problem                           | Fix                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Error: Please use Node.js >= 24` | Update Node via nvm/Homebrew. Run `nvm install 24 && nvm use 24`.                                                     |
| Port 3000 already in use          | `bun run dev` detects the conflict and offers the next free port. To force a port, run `bun run dev -- --port 3001`, or free the port (`lsof -ti:3000 \| xargs kill`). |
| Tailwind classes not applied      | Ensure the file lives under `app/` or add an explicit `@source` path in `main.css`.                                   |
| OpenRouter auth redirect fails    | Confirm `NUXT_PUBLIC_OPENROUTER_REDIRECT_URI` matches the URL registered with OpenRouter and the Nuxt dev server URL. |
| PWA caches stale assets           | Clear Application → Cache Storage and unregister the service worker.                                                  |

---

## Next steps

-   Review the repository `README.md` for feature overview and architecture notes.
-   Explore the documentation under `/documentation` once the dev server is running—the docs shell uses the same responsive layout you just configured.
-   Try the plugin examples in `app/plugins/examples/` to see how hooks and UI registries integrate with the running app.
