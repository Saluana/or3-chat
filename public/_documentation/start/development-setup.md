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

## Open development on a phone or over Tailscale

To reach the dev server from another device, bind it to the network interface:

```bash
bun run dev -- --host 0.0.0.0 --port 3000
```

HTTP LAN and Tailscale IP addresses do not get localhost's secure-context exception.
OR3 uses the existing SHA-256 implementation when Web Crypto is unavailable, including
document revisions, chat fingerprints, plugin digests, and signed history cursors.
OpenRouter PKCE remains S256. Optional history-tool initialization failures leave
the rest of the app available and emit a `[history-tools]` console diagnostic.

Use HTTPS for browser features that require a secure context, such as service workers
and clipboard access. Tailscale Serve can proxy the existing dev server within your tailnet:

```bash
tailscale serve --bg --https=3443 http://localhost:3000
```

Open the HTTPS hostname and port printed by Tailscale on your phone. Choose a free Serve
port when other apps already use it. Browser data belongs to each origin: the IP URL
and HTTPS hostname have separate local workspaces. Export a Workspace Backup when
transferring local data to another origin.

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

## Build and launch source output

The build wrapper defaults Node's old-space heap limit to 4096 MiB and preserves
an explicit limit in `NODE_OPTIONS`, including a lower limit. The heap limit is
only part of the build's total memory use. Leave room for native allocations,
workers, and the operating system; a small VPS may need the build performed on
a larger machine.

```bash
NODE_OPTIONS=--max-old-space-size=3072 bun run build
```

Exit 137 or `SIGKILL` means the process was killed. Check the host or container's
memory limit and OOM logs before attributing it to an application defect.
Raising the heap limit can increase memory pressure.

Bun installs dependencies and runs repository commands. The source dev and
build wrappers select Node for the default Basic Auth/SQLite stack. For advanced
source operation with that stack, start the built server with Node 24 and load
its environment explicitly:

```bash
node --env-file=.env .output/server/index.mjs
```

Running this default server directly with Bun bypasses the wrappers and can
crash when `better-sqlite3` loads. Bun SQLite needs a compatible auth provider;
see [SQLite runtimes](/documentation/cloud/provider-sqlite#bun). The source
doctor checks configuration, packages, paths, and ports; verify deep health and
authenticated behavior after starting the server.

## Find the right files

Production builds share one KaTeX renderer across Markdown and diagrams. The
document extraction worker loads when a file is extracted, and the trusted
plugin UI kit loads when a plugin activates. The production asset gate checks
total assets separately from initial module preloads; the Projects/Files
baseline includes the extraction worker while retaining the initial-load limit.
Preview screenshots and unused icon variants are served on demand rather than
cached during PWA installation.

The browser model catalog uses the SDK's Models entry point only after checking
its persisted catalog. The full SDK loads when OAuth exchange, memory
classification, or a trusted plugin requests a provider client; plugin activation
alone does not load it. Provider authorization is checked again after loading.
Request headers, model pagination, API URL configuration, and cached catalog
fallback remain shared. App metadata respects the configured site description;
the default favicon comes from the base configuration.

Optional document conversion and Cloud sync implementations load on demand.
Storage transfers and workspace plugin adapters load behind their existing feature
checks, completing setup before the app mounts when enabled. The plugin development
controller loads only in development-preview mode. Local-only builds skip the
trusted-plugin host proof unless plugin development is enabled; managed builds
still complete the proof before activating trusted plugins. History-tool definitions
remain available at startup, while retrieval execution code loads on first use
and rechecks the captured workspace before reading content.
Production client builds group the existing entry and chat-shell dependency trees
into bounded chunks to reduce small startup requests. Rolldown's strict execution
order preserves module initialization order; the server bundle keeps its existing
configuration. This trades a small increase in complete JavaScript size for fewer
requests and less compressed JavaScript on the initial chat route. Optional feature
roots remain lazy, and the composer keeps its existing editor and extensions.
A closed mobile drawer mounts its page on first opening and retains it afterward.
The first-run welcome starts its key and dismissal reads together, shares an
in-flight key read with other startup consumers, and remains hidden until mount
and the existing authentication checks complete. Credentials stay in Dexie.
Desktop sidebar width stays bounded during loading; malformed persisted widths
are ignored in favor of the normal default. The desktop rail footer uses initial
component CSS to stay anchored while its client-only controls mount; the search
header reserves its normal minimum height while allowing taller theme controls.

Nuxt's source directory is `app/`: `~/` and `@/` refer there, while `~~/` refers to the repository root.

| Directory | Responsibility |
| --- | --- |
| `app/pages/`, `app/components/` | Routes and UI. |
| `app/core/`, `app/composables/` | Feature logic, hooks, and registries. |
| `app/db/` | Browser persistence and entity helpers. |
| `server/` | SSR endpoints and server integrations. |
| `shared/` | Contracts shared across runtimes. |
| `public/_documentation/` | Documentation pages and navigation map. |

The [source contributor map](/documentation/start/source-map) identifies feature controllers and extension registries.

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

A local module request returning **504 Outdated Optimize Dep** means Vite
invalidated an optimized dependency URL; it does not establish an OpenRouter or
internet outage. Mobile WebKit may report this as **Importing a module script failed**
and leave the server-rendered shell visible. The source dev configuration pre-optimizes
the lazy tool validator, HMAC, and SDK Models/HTTP entry points to avoid invalidating
in-flight module URLs during the first load. Reload the tab after dependency optimization completes. If it
persists, restart the source dev server and reload. Production browser journeys and scroll canaries
use separate build directories and Vite caches so their config cannot invalidate an active source
dev server's dependency cache.
