# Development Environment Setup

One command gets a source checkout running locally. No API key, `.env` file, or
manual dependency install is required for the local-first app.

---

## 1. Prerequisites

You need only:

- **Node.js 24+**. Verify with `node -v`.
- **Git** to clone the repository.
- A modern browser.

Bun is optional. It is the repository's canonical package manager, but the
first-run command below works with the Node/npm that comes with Node.js.

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

```bash
npm start
```

That command installs dependencies on the first run, asks one question
(local-first chat or managed Cloud), and starts the app. Later, run `npm start`
again. If you use Bun, `bun start` follows the same flow.

Local-first mode needs no account or `.env` file. It stores data in the
browser. Connect OpenRouter from the in-app onboarding when you are ready.

For the managed local Cloud profile directly, run:

```bash
npx @or3/cloud init --local
```

This generates its own secure configuration and password; it does not need a
source checkout or manually entered application environment variables.

---

## 4. Optional developer configuration

You only need `.env` values when developing a specific integration. For
example, an OpenRouter API key can be supplied to test server-side behavior:

Edit `.env` (git-ignored) and set at least:

```ini
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxx
OPENROUTER_MODEL=openai/gpt-oss-120b
```

These are optional for normal local development. Restart the dev server after
changing environment files so Nuxt picks them up.

---

## 5. Start the Nuxt dev server manually

```bash
npm run dev
```

-   Nuxt serves the app at **http://localhost:3000/** by default.
-   Pass extra flags after `--` (e.g., `npm run dev -- --https --open`).
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
-   **Console logging**: leverage OR3's `~/utils/errors.ts` helpers (`reportError`, `withErrorToast`) for structured logs and toast integration.
-   **Dexie debugging**: install the [Dexie Inspector](https://chromewebstore.google.com/detail/dexie-inspector/dhgnppuogchnjdlacomooganmphadamk) for richer IndexedDB views.
-   **VS Code launch config**: attach to the Vite server by adding a "Chrome" debug profile pointing at `http://localhost:3000`. Source maps resolve back to files in `app/` thanks to Nuxt 4 + Vite.
-   **Hot module quirks**: if Nuxt HMR gets stuck, stop the dev server, delete `.nuxt/` and `node_modules/.vite`, then rerun `bun run dev`.

---

## 9. Keeping dependencies up to date

-   Upgrade Nuxt/Tailwind by running `bun x nuxi upgrade` or editing `package.json`, then `bun install`.
-   Regenerate type imports after dependency changes:

```bash
bun run nuxi cleanup
bun run nuxi prepare
```

-   Commit the updated `bun.lock` so teammates pull the same versions.

---

## 10. Common issues & fixes

| Problem                           | Fix                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Error: Please use Node.js >= 24` | Update Node via nvm/Homebrew. Run `nvm install 24 && nvm use 24`.                                                     |
| Port 3000 already in use          | Run `bun run dev -- --port 3001` or free the port (`lsof -i :3000`).                                                  |
| Tailwind classes not applied      | Ensure the file lives under `app/` or add an explicit `@source` path in `main.css`.                                   |
| OpenRouter auth redirect fails    | Confirm `NUXT_PUBLIC_OPENROUTER_REDIRECT_URI` matches the URL registered with OpenRouter and the Nuxt dev server URL. |
| PWA caches stale assets           | Clear Application → Cache Storage and unregister the service worker.                                                  |

---

## Next steps

-   Review the repository `README.md` for feature overview and architecture notes.
-   Explore the documentation under `/documentation` once the dev server is running—the docs shell uses the same responsive layout you just configured.
-   Try the plugin examples in `app/plugins/examples/` to see how hooks and UI registries integrate with the running app.
