# tasks.md

artifact_id: or3-cloud-config-tasks
date: 2026-01-23

## 1. Define Types and Utilities

- [ ] Create `types/or3-cloud-config.d.ts` (or similar location) to define the `Or3CloudConfig` interface.
- [ ] Create a utility file (e.g., `utils/or3-cloud-config.ts`) exporting `defineOr3CloudConfig` helper for type inference.

## 2. Create Config File

- [ ] Create `config.or3cloud.ts` in the root directory.
- [ ] Populate it with default values utilizing `process.env` to maintain backward compatibility with existing `.env` setups.
- [ ] Add extensive JSDoc comments to options for developer guidance.

## 3. Refactor `nuxt.config.ts`

- [ ] Import `config.or3cloud.ts` in `nuxt.config.ts`.
- [ ] Replace direct `process.env` lookups in `runtimeConfig` with values from `or3CloudConfig`.
- [ ] Update `modules` section to conditionally load `@clerk/nuxt` and `convex-nuxt` based on `or3CloudConfig` flags.
- [ ] Ensure `alias` and other build settings are compatible.

## 4. Verification & Testing

- [ ] Verify that disabling `auth.enabled` in `config.or3cloud.ts` correctly disables SSR auth features and Clerk module.
- [ ] Verify that `sync.enabled` toggle works as expected.
- [ ] Check if static builds (without SSR auth) still function correctly.
- [ ] Verify type checking (`bun run type-check`) passes with the new config structure.

## 5. Documentation

- [ ] Update main README or create a new doc explaining how to use `config.or3cloud.ts` to manage the environment.
