# Intern A Playbook – Sidebar Core Hardening

## Scope Guard

-   Own anything under `app/composables/core` and `app/composables/sidebar`, plus `app/db/posts.ts` and related test files.
-   Stay out of `app/plugins/examples`, `docs/plugins`, and any file that mentions “Snake”; those belong to Intern B.
-   You can touch `types/global.d.ts`, `tests/**`, and new helper files if they support your tasks.
-   Run commands from repo root; prefer `bun` scripts that already exist.

## Task List

-   [x] Replace every `any` in the sidebar composables with safe types or guarded `unknown`.
-   [x] Add Zod validation to plugin registration (`registerPaneApp`, `registerSidebarPage`) and post meta handling.
-   [x] Refactor the global registry to use Vue reactive state (no manual `version++` counters).
-   [x] Harden activation hooks with proper error boundaries, logging, and user-friendly fallbacks.
-   [x] Debounce the Orama search index rebuild and keep it out of the hot path.
-   [x] Backfill or fix unit tests so the new behaviour is covered (validation, reactivity, debounce).
-   [x] Finish by running `bun run typecheck` and `bun test` to prove everything still compiles.

## 1. Drop the `any` Crutch

Best practice: prefer specific interfaces; when you must accept unknown input, use `unknown` and narrow it. Casting to `any` is a last resort that hides bugs.

1. Create a shared type definition for the sidebar registries. A pattern that works well:
    ```ts
    // types/global.d.ts
    import type { RegisteredPaneApp } from '~/composables/core/usePaneApps';
    declare global {
        interface Window {
            __or3PaneAppsRegistry?: Map<string, RegisteredPaneApp>;
        }
        var __or3PaneAppsRegistry: Map<string, RegisteredPaneApp> | undefined;
    }
    export {};
    ```
2. Update `usePaneApps.ts`, `useSidebarPages.ts`, `useSidebarSearch.ts`, and `registerSidebarPage.ts` to use real types. Examples:

    ```ts
    interface SidebarActivateContext {
        page: SidebarPageDef;
        previousPage: SidebarPageDef | null;
        isCollapsed: boolean;
        multiPane: UseMultiPaneApi;
        panePluginApi: PanePluginApi;
    }

    function isDocPost(post: Post): post is DocPost {
        return post.postType === 'doc' && !post.deleted;
    }
    ```

3. Replace casts like `(d as any)` with proper guards (see the `isDocPost` helper above).
4. If you discover shape assumptions, codify them with interfaces next to where they’re used; keep the definitions tight so IntelliSense guides future devs.

## 2. Validate Inputs at Plugin Boundaries

Best practice: validate external or user-provided data at the entry point. Use `zod` since it’s already in the project.

1. Add schemas for `PaneAppDef` and `SidebarPageDef` in their respective composables:
    ```ts
    const PaneAppDefSchema = z.object({
        id: z
            .string()
            .min(1)
            .regex(/^[a-z0-9-]+$/, 'lowercase id only'),
        label: z.string().min(1).max(100),
        component: z.union([
            z.any(), // Vue component
            z.function().returns(z.promise(z.any())),
        ]),
        order: z.number().int().min(0).max(1000).optional(),
        postType: z.string().optional(),
        createInitialRecord: z
            .function()
            .args(z.object({ app: z.any() }))
            .returns(
                z.promise(z.union([z.object({ id: z.string() }), z.null()]))
            )
            .optional(),
    });
    ```
2. Wrap registrations with `safeParse`. On failure, log the issues and throw:
    ```ts
    const parsed = PaneAppDefSchema.safeParse(def);
    if (!parsed.success) {
        console.error('[usePaneApps] Invalid definition', parsed.error);
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid pane app');
    }
    ```
3. Do the same for sidebar pages (`registerSidebarPage`) and for `normalizeMeta` in `app/db/posts.ts`. For meta, reject unserialisable objects instead of returning `undefined`.
4. Document newly enforced constraints in code comments right above the schema so plugin authors understand the contract.

## 3. Stabilise the Global Registry

Best practice: let Vue track reactivity; avoid manual counters that developers can forget.

1. Build a helper like `useGlobalRegistry` (new file `app/composables/_registry.ts` is fine):
    ```ts
    export function useGlobalRegistry<T>(key: string, init: () => T): T {
        const globalKey = `__or3_${key}`;
        const store = globalThis as Record<string, T>;
        if (!store[globalKey]) {
            store[globalKey] = reactive(init()) as T;
        }
        return store[globalKey];
    }
    ```
2. Use that helper in both `usePaneApps.ts` and `useSidebarPages.ts` so they share the same pattern.
3. Remove every `reactiveRegistry.version++` call. Vue will react when the map mutates.
4. Ensure computed getters iterate `Array.from(registry.values())` so Vue tracks the dependency.

## 4. Harden Activation Hooks

Best practice: never let plugin hooks break the sidebar silently. Catch errors, roll back state, and notify observability.

1. Wrap `canActivate`, `onDeactivate`, and `onActivate` calls in a try/catch that:
    - Records the previous `activePageId`.
    - Reports to `hooks.doAction('ui.sidebar.page:action:load-error', …)` or similar.
    - Surfaces a user-friendly fallback (set `errorMessage.value` and show an alert toast component if one exists).
2. Reset the `activePageId` if activation fails so the UI stays consistent.
3. Provide a default guard that warns in dev when `setActivePage` receives an unknown id.
4. Add unit coverage for:
    - `canActivate` returning `false`.
    - `onActivate` throwing and the state reverting.

## 5. Debounce Orama Index Rebuilds

Best practice: when working with large lists, debounce expensive recompute work and avoid deep watchers.

1. In `useSidebarSearch.ts`, replace the `watch` that instantly rebuilds with something like:
    ```ts
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    watch(
        [threads, projects, documents],
        () => {
            if (rebuildTimer) clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(async () => {
                await ensureIndex();
                await runSearch();
            }, 300);
        },
        { deep: false }
    );
    ```
2. Extract the debounce duration into a constant so you can reference it in tests.
3. Use fake timers in Vitest to assert the debounce behaviour (see example in the old review).

## 6. Tests and Verification

Best practice: every new guard should have a regression test. Focus on small, fast unit tests.

1. Update `app/composables/core/__tests__/usePaneApps.test.ts` to cover invalid ids, labels, and duplicate registration warnings.
2. Add tests in `app/composables/sidebar/__tests__` for `setActivePage` error handling and the debounce logic.
3. If you add helpers, keep them in `tests/utils` so both interns can reuse them without conflicts.
4. Run:
    ```bash
    bun run typecheck
    bun test
    ```
    Paste key failures in your PR if something flaky appears.

## Done Criteria

-   TypeScript passes with zero `any` in the touched files (use `rg "as any"` to confirm).
-   Plugin registration throws when fed invalid input.
-   Sidebar activation rolls back cleanly on hook errors.
-   Search index rebuild happens once per burst, confirmed by tests.
-   No files outside your scope were changed.
