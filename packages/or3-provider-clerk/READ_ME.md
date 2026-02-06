# or3-provider-clerk (local package stub)

This folder is a **local-only stub** for the Clerk provider module. It is not a
published package yet. When you're ready to extract it, follow the steps below.

## Finish extraction (when ready)

1. **Create `package.json`**
   - Name: `or3-provider-clerk`
   - `type: "module"`
   - `exports` should expose:
     - `./nuxt` → `./dist/module.mjs` (or `./src/module.ts` during local dev)
     - `./runtime/*` as needed for tests
   - `dependencies` should include:
     - `@clerk/nuxt`
   - `peerDependencies` should include:
     - `nuxt` (match repo version)
2. **Add build tooling**
   - Minimal: `tsconfig.json` + `unbuild` (or `tsup`) to emit `dist/`
3. **Wire workspace/dev install**
   - Add to root workspaces or `bun link`.
   - Update `or3.providers.generated.ts` to use `or3-provider-clerk/nuxt`.
4. **Docs**
   - Document required env vars: `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
     `NUXT_CLERK_SECRET_KEY`.

## Current runtime entrypoints

- `src/module.ts`
- `src/runtime/server/plugins/register.ts`
- `src/runtime/server/middleware/00.clerk.ts`
- `src/runtime/plugins/auth-token-broker.client.ts`
- `src/runtime/plugins/session-logout-bridge.client.ts`
