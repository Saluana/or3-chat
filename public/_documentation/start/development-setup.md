# Develop OR3 from source

Use this path to change OR3 itself or work on a trusted source extension. To run a managed deployment, use [Cloud setup](/documentation/cloud/setup). To build a portable plugin, start with [your first plugin](/documentation/plugins/first-plugin).

## Install and start

The repository requires Git, Node.js 24 or newer, and Bun. The package manager version is pinned in `package.json` (currently Bun 1.3.14). Use Bun for repository commands.

```bash
git clone https://github.com/Saluana/or3-chat.git
cd or3-chat
bun install
bun run dev
```

Open the URL printed by the startup banner. Local-first development needs no account or environment file; connect OpenRouter through the app when you want to generate a response.

The dev wrapper checks port availability on both IPv4 and IPv6. If the port is occupied, it explains the conflict and offers an alternative. Use the printed URL: another server on port 3000 may be serving older code. To request another port, run `bun run dev -- --port 3001`.

## Choose a development mode

| Command | Purpose |
| --- | --- |
| `bun run dev` | Normal source development. |
| `bun run dev:offline` | Local-first development with Cloud features disabled. |
| `bun run dev:ssr` | Develop SSR auth and Cloud integrations; requires a working provider configuration for authenticated features. |
| `bun run build` | Build application output. |
| `bun run generate:static` | Build the explicitly static, Cloud-disabled output. |
| `bun run preview` | Preview built application output. |

For provider configuration, use the [source setup wizard](/documentation/cloud/or3-cloud-wizard). Restart after configuration changes. An environment file is an advanced integration tool, not a prerequisite for the ordinary local-first app.

## Find the right files

Nuxt's source directory is `app/`: `~/` and `@/` refer there, while `~~/` refers to the repository root.

| Directory | Responsibility |
| --- | --- |
| `app/pages/`, `app/components/` | Routes and UI. |
| `app/core/`, `app/composables/` | Feature logic, hooks, and registries. |
| `app/db/` | Browser persistence and entity helpers. |
| `server/` | SSR endpoints and server integrations. |
| `shared/` | Contracts shared across runtimes. |
| `public/_documentation/` | Documentation pages and navigation map. |

Use [hooks](/documentation/hooks/overview) and registries for extension points. Use existing Nuxt UI variants in `app.config.ts` and the [theme system](/documentation/themes/overview) for UI changes. Keep server SDKs under server boundaries and browser storage in client paths.

## Work with sibling packages

The dev wrapper can rebuild available sibling provider repositories. Missing siblings or build failures fall back to installed packages with a warning. Use `OR3_LOCAL_PROVIDERS=false bun run dev` to use installed provider packages. See [provider development](/documentation/cloud/providers#local-provider-development).

Development can also alias the adjacent Scroll checkout when valid. Use `OR3_USE_LOCAL_PACKAGES=false bun run dev` to disable those source aliases. Portable plugins such as Workflows and External Agents are built and installed as packages; the host does not alias their feature dependencies. Production builds use installed packages.

## Verify a change

Run the narrowest affected existing test files, or `bun run test:changed`. `bun run test` runs the fast core lane; integration, scripts, release policy, and plugin compatibility have separate lanes. Use the named E2E harness for browser journeys rather than a broad command that also runs credential or paid-network suites.

For docs, update `docmap.json`, use `/documentation/...` links, and run `bun scripts/release/check-docs.mjs`. Open changed pages to check navigation and readability.

## Troubleshoot without losing data

Inspect IndexedDB in browser developer tools. Local-first storage uses `or3-db`; authenticated workspaces use `or3-db-<workspaceId>`. Obtain the active database at operation time with `getDb()`; see [database safety](/documentation/database/safe-changes).

Export **Workspace Backup** before clearing site data. Clearing localStorage alone does not reset Dexie data, and deleting an IndexedDB database removes local workspace records and blobs. Check the active profile, origin, workspace, and dev-server URL before concluding that data has disappeared.

If a PWA serves old assets, inspect Cache Storage and service-worker registration. If HMR becomes stuck, stop your own dev process, remove generated `.nuxt/` and `node_modules/.vite/` caches, and restart. For model connection errors, follow [OpenRouter troubleshooting](/documentation/auth/connect#troubleshooting).
