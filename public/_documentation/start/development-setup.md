# Development Environment Setup

Step-by-step instructions for getting OR3 running locally. This guide covers cloning the repository, installing dependencies with Bun, configuring required environment variables, starting the Nuxt 4 dev server, and debugging the Tailwind-powered UI.

---

## 1. Prerequisites

Make sure the following tools are installed before you start:

-   **Node.js 20.11+** (Nuxt 4 targets modern runtimes). Verify with `node -v`.
-   **Bun 1.1+** (project uses `bun.lockb`). Install from [bun.sh](https://bun.sh) and verify with `bun -v`.
-   **Git 2.40+** for cloning and keeping your fork up to date.
-   A modern browser (Chromium, Firefox, or Safari) for IndexedDB + Nuxt DevTools.
-   Recommended editor: **VS Code** with the official Vue, TypeScript, and Tailwind CSS extensions.

> **Using npm or pnpm instead?** Bun is the default, but `npm install` / `pnpm install` also work. Delete `bun.lockb` or regenerate your lockfile if you switch package managers.

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

## 3. Install dependencies

```bash
# Install node modules using Bun
bun install

# Bun automatically runs "postinstall" (nuxt prepare) after packages finish installing.
```

> **First run on macOS?** You may need to grant the terminal network access the first time Bun starts the dev server.

If you prefer npm/pnpm:

```bash
npm install  # or pnpm install
```

Nuxt 4 requires ESM; make sure your shell keeps `NODE_OPTIONS` clean (no CommonJS flags).

---

## 4. Configure environment variables

OR3 talks directly to OpenRouter. Create a local env file so you do not commit secrets:

Edit `.env` (git-ignored) and set at least:

```ini
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxx
OPENROUTER_MODEL=openai/gpt-oss-120b
```

These are only used in developement mode for testing and are not required. Without them some tests may fail.

Restart the dev server after changing environment files so Nuxt picks up new values.

---

## 5. Start the Nuxt dev server

```bash
bun run dev
```

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
-   To add custom utilities, extend `app/assets/css/retro.css` or create a new stylesheet imported from `main.css`.
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

-   Commit the updated `bun.lockb` so teammates pull the same versions.

---

## 10. Common issues & fixes

| Problem                           | Fix                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Error: Please use Node.js >= 20` | Update Node via nvm/Homebrew. Run `nvm install 20 && nvm use 20`.                                                     |
| Port 3000 already in use          | Run `bun run dev -- --port 3001` or free the port (`lsof -i :3000`).                                                  |
| Tailwind classes not applied      | Ensure the file lives under `app/` or add an explicit `@source` path in `main.css`.                                   |
| OpenRouter auth redirect fails    | Confirm `NUXT_PUBLIC_OPENROUTER_REDIRECT_URI` matches the URL registered with OpenRouter and the Nuxt dev server URL. |
| PWA caches stale assets           | Clear Application → Cache Storage and unregister the service worker.                                                  |

---

## Next steps

-   Review the repository `README.md` for feature overview and architecture notes.
-   Explore the documentation under `/documentation` once the dev server is running—the docs shell uses the same responsive layout you just configured.
-   Try the plugin examples in `app/plugins/examples/` to see how hooks and UI registries integrate with the running app.
