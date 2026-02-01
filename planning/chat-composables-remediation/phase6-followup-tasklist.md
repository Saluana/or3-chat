# Phase 6 Follow-up: `useAi.ts` size + docs + warnings

Goal: get `app/composables/chat/useAi.ts` under **2000 LOC**, improve JSDoc quality (doc-maker style), and eliminate Nuxt auto-import **"Duplicated imports"** warnings.

Hard constraints:
- Public import path stays: `~/composables/chat/useAi`
- `useChat()` return shape and runtime behavior stay stable
- SSR/static safety: no server-only imports leak into client bundles
- Bun-only workflows

---

## A) Stop Nuxt auto-import duplicate warnings

- [x] A1. Move internal `useAi` modules out of `app/composables/**` scanning
  - Move: `app/composables/chat/_useAi/*` → `app/utils/chat/useAi-internal/*`
  - To: `app/utils/chat/useAi-internal/*` (not scanned by `imports.dirs`)
  - Update imports in `app/composables/chat/useAi.ts`

- [x] A2. Verify warnings are gone
  - Run: `bun run nuxi typecheck`
  - Acceptance: **no** `WARN  Duplicated imports ... ignored` lines

---

## B) Reduce `useAi.ts` under 2000 LOC (non-breaking)

- [ ] B1. Extract `retryMessage()` into internal module
  - New: `app/utils/chat/useAi-internal/retry.ts`
  - Facade keeps `retryMessage` as before, implemented by calling module

- [ ] B2. Extract `continueMessage()` into internal module
  - New: `app/utils/chat/useAi-internal/continue.ts`

- [ ] B3. Extract file prep helpers out of `sendMessage()`
  - New: `app/utils/chat/useAi-internal/files.ts`
  - Move: `normalizeFileUrl`, `prepareFilesForModel`, `hashToContentPart` (exact behavior)

- [ ] B4. Extract foreground streaming loop (tool loop + persistence cadence)
  - New: `app/utils/chat/useAi-internal/foregroundStream.ts`
  - Keep hook timing + orchestration decisions in facade

- [ ] B5. Extract system prompt + OpenRouter message build glue
  - New: `app/utils/chat/useAi-internal/messageBuild.ts`

- [ ] B6. Recount LOC and ensure under 2000
  - Run: `wc -l app/composables/chat/useAi.ts`

---

## C) JSDoc upgrades (doc-maker style)

- [ ] C1. Add module-level header to `useAi.ts` (Purpose/Responsibilities/Constraints/Non-goals/Invariants)
- [ ] C2. Upgrade `useChat()` JSDoc: lifecycle, cleanup, error contracts, abort semantics
- [ ] C3. Add short module headers to each new internal module

---

## D) Verification

- [ ] D1. Typecheck
  - Run: `bun run nuxi typecheck`

- [ ] D2. Regression tests
  - Run: `bunx vitest run`

- [ ] D3. Spot-check no SSR boundary violations
  - Quick scan: internal modules must not import from `server/**`

---

## Notes
- Keep extractions strictly mechanical: no renames, no behavior changes.
- Prefer dependency injection via a small `ctx` object passed into internal helpers (avoids circular imports).
