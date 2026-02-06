# or3-provider-convex (local package stub)

This folder is a **local-only stub** for the Convex provider module. It is not a
published package yet. When you're ready to extract it, follow the steps below.

## Finish extraction (when ready)

1. **Create `package.json`**
   - Name: `or3-provider-convex`
   - `type: "module"`
   - `exports` should expose:
     - `./nuxt` → `./dist/module.mjs` (or `./src/module.ts` during local dev)
     - `./runtime/*` as needed for tests
   - `dependencies` should include:
     - `convex`, `convex-nuxt`, `convex-vue`
   - `peerDependencies` should include:
     - `nuxt` (match repo version)
2. **Add build tooling**
   - Minimal: `tsconfig.json` + `unbuild` (or `tsup`) to emit `dist/`
3. **Wire workspace/dev install**
   - Add to root workspaces or `bun link`.
   - Update `or3.providers.generated.ts` to use `or3-provider-convex/nuxt`.
4. **Convex backend distribution**
   - Add a CLI script (e.g. `bunx or3-provider-convex init`) that copies
     `convex/**` templates into the host repo.
   - Ensure Convex codegen runs **in the host repo**, not inside this package.
5. **Docs**
   - Document required env vars: `OR3_SYNC_CONVEX_URL`, `OR3_SYNC_CONVEX_ADMIN_KEY`.

## Current runtime entrypoints

- `src/module.ts`
- `src/runtime/plugins/convex-sync.client.ts`
- `src/runtime/plugins/convex-storage.client.ts`
- `src/runtime/server/plugins/register.ts`
