---
artifact_id: 7d0c0e6b-b3f1-4a4d-9c31-e9f8b22eb3ce
status: draft
owner: or3-chat
last_updated: 2026-02-01
---

# tasks.md

## 0. Prep / safety rails
- [ ] Create a short working branch locally (optional, no commit required).
- [ ] Add/confirm a focused test file location under `tests/unit/` for theme utilities. (Requirements: 2.1, 3.1, 3.2, 4.1)

## 1. P0 correctness + confusion fixes (defaults + blank theme)
- [ ] Fix `app/theme/blank/theme.ts` doc comment mismatch (“Retro theme” copy/paste). (Requirements: 1.1)
- [ ] Remove or set `isDefault: false` for the blank theme if it is not intended to be default. (Requirements: 1.1)
- [ ] Add dev-only warning when runtime config overrides the manifest default. (Requirements: 1.2)
- [ ] Introduce a single fallback constant (e.g., `FALLBACK_THEME_NAME`) and remove scattered `'retro'` literals where feasible. (Requirements: 1.1, 7.2)

## 2. Shared core refactor (remove duplication)
- [ ] Add `app/theme/_shared/constants.ts` for fallback name + name regex pattern. (Requirements: 1.1, 3.1, 7.2)
- [ ] Add `app/theme/_shared/default-theme.ts` implementing `pickDefaultTheme()`. (Requirements: 1.1, 1.2)
- [ ] Refactor `app/theme/_shared/theme-core.ts`:
  - [ ] Update `sanitizeThemeName()` to normalize + stricter pattern. (Requirements: 3.1)
  - [ ] Ensure `readCookie()` is the canonical cookie reader. (Requirements: 3.2)
- [ ] Add `app/theme/_shared/theme-loader.ts` and move shared logic out of both plugins:
  - [ ] `ensureThemeLoaded()` with in-flight dedupe. (Requirements: 2.1, 5.2)
  - [ ] `setActiveThemeSafe()` that never throws. (Requirements: 4.1)
- [ ] Update `app/plugins/90.theme.client.ts` to use shared modules instead of local copies. (Requirements: 2.1, 4.1)
- [ ] Update `app/plugins/90.theme.server.ts` to use shared modules instead of local copies. (Requirements: 2.1, 2.2)
- [ ] Remove/replace unused shared `loadTheme` code paths so there is no dead code left. (Requirements: 2.1)

## 3. Safety hardening (cookies, injection, manifest errors)
- [ ] Replace client cookie regex parsing with `readCookie(document.cookie, name)`. (Requirements: 3.2)
- [ ] Add defensive guards to CSS variable injection (no throw if `document.head` missing, escape `</style>`). (Requirements: 5.1)
- [ ] Update theme manifest loader to return `{ entries, errors }` and log aggregated failures once in dev. (Requirements: 4.2)

## 4. Race conditions and dedupe
- [ ] Implement in-flight dedupe in stylesheet loading to prevent duplicate `<link>` tags under rapid switching. (Requirements: 5.2)
- [ ] Add unit tests with a mocked DOM verifying only one link gets appended for the same `(theme, href)` across concurrent calls. (Requirements: 5.2)

## 5. Memory leak and cache policy fixes
- [ ] Bound the per-component override cache in `useThemeResolver` (cap + eviction; reset on theme change). (Requirements: 6.1)
- [ ] Fix `page:finish` hook cleanup in the client plugin (unregister hook + clear timeout). (Requirements: 6.2)
- [ ] Add `cleanupInactiveThemes` to the server plugin (mirror client behavior). (Requirements: 6.3)
- [ ] Ensure inactive theme cleanup also calls `iconRegistry.unregisterTheme(themeName)`. (Requirements: 6.3)
- [ ] Bound selector cache in `app/theme/_shared/compiler-core.ts` (LRU or dev-HMR clear). (Requirements: 6.4)
- [ ] Decide/document whether `kebabCache` can remain unbounded; if yes, add a short rationale in code. (Requirements: 6.4)

## 6. Type safety + code organization
- [ ] Move `ThemePlugin` type out of `app/plugins/90.theme.client.ts` into `app/theme/_shared/types.ts` (or existing shared types file) and update imports. (Requirements: 7.2)
- [ ] Tighten `RuntimeResolver` return types so `ResolvedOverride.props` is not just `Record<string, unknown>` and includes known/debug fields. (Requirements: 7.1)
- [ ] Keep the existing Map-based LRU implementation but add a doc comment explaining the tradeoff (avoid “half-LRU” rewrites). (Requirements: 6.4)

## 7. Validation improvements (colors)
- [ ] Update color validation to prefer `CSS.supports('color', value)` when available; keep a strict fallback for SSR/tests. (Requirements: 8.1)
- [ ] Add unit tests for common valid/invalid color strings. (Requirements: 8.1)

## 8. Verification
- [ ] Run unit tests: `bun run test`. (Requirements: all)
- [ ] Smoke-check in dev:
  - [ ] Default theme selection logs in dev only.
  - [ ] Theme switching rapidly does not duplicate stylesheets.
  - [ ] No console unhandled rejection on failed theme import.
  - [ ] HMR does not accumulate `page:finish` handlers.

## 9. Documentation sync
- [ ] Add a short “Theme defaults precedence” note to existing docs if there is a theme system doc page, or create one in `docs/` if missing. (Requirements: 1.1, 1.2)
