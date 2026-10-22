# OR3 Chat dependency audit — 2026-10-21

50 of 90 registry dependencies in the root manifest have a newer stable release: 24 runtime dependencies and 26 development dependencies. Seven explicitly overridden transitive packages also have newer releases. Several updates deserve attention for security; the largest major upgrades should be separate migrations.

**No dependencies were updated.** No install, upgrade, manifest edit, lock regeneration, browser download or lifecycle script was run. The initial and final SHA-256 checks of package.json, bun.lock and package-lock.json match. This report is the only repository file created for the audit.

## Scope and interpretation

- Inspected the root manifest (50 runtime + 41 development entries), all tracked package/plugin/example/template manifests, Bun configuration, overrides, both lockfiles, runtime/build wrappers and relevant integration callers. One root dependency, @or3/plugin-sdk, is a local file dependency; the other 90 were checked against live npm registry metadata.
- “Locked” below means the source Bun lock, not the minimum version written after a caret in package.json. For example, TipTap is declared ^3.30.5 but locked at 3.31.3.
- “Latest” is the stable npm latest tag observed on October 21, 2026. Prereleases and canary builds are excluded. A published version is an available candidate, not proof that it works in OR3.
- package-lock.json intentionally represents the pruned Basic Auth + SQLite + filesystem managed profile. Clerk, Convex and S3 are excluded there. It must not be treated as an accidental duplicate of the source Bun graph.
- Security checks: Bun registry audit for the source graph, plus a separate npm advisory query for all 1,099 unique non-dev package names in the production lock. Findings were matched to actual locked versions. Source: 43 flagged package names / 92 unique advisory URLs. Fixed-profile non-dev graph: 15 flagged names / 24 unique advisory URLs. These overlapping counts must not be added together.
- “Non-dev in the lock” does not prove execution in the deployed Nitro output. Nuxt build/development tools also enter that graph. Reachability and exploitability were not proven, and no live deployment or data was accessed.

## Recommended order

1. **Address security-related patches and stale transitive resolutions first.** Prioritize Vite 8.3.5, the fast-uri override at 3.1.9, markdown-it 14.3.3, DOMPurify 3.4.17, and the affected optional Clerk stack on its existing major. Fix nested copies as well as the top-level copy.
2. **Qualify a coordinated Nuxt/UI/editor batch.** Nuxt + Kit 4.6.2, Vue 3.5.44, Router 5.4.0, Nuxt UI 4.12.0, Reka 2.11.0; TipTap 3.32.0 needs the ProseMirror overrides raised with it. These dependencies have explicit coupling, so they should not be bumped independently without checking the full graph.
3. **Take smaller tooling patches before majors.** Vitest + coverage 4.1.12 and es-module-lexer 2.3.2 are available even though the ordinary outdated output emphasizes the newer major. Update Node types within 24.x. Low-risk utility/icon/React patches can be small batches.
4. **Separate deliberate migrations.** TypeScript 6, Vitest 5, jsdom 30, ESLint 10, VueUse 15, vue-tsc 3, KaTeX, and tokenizer 4 should each have focused validation. TypeScript 7 is not a direct replacement for this repository today. Keep h3 1.x and the current PWA wrapper contract until their owners are migrated.

## Breaking changes and concrete OR3 implications

### TypeScript: hold 7.0.2 as a direct replacement

TypeScript 7 ships a native compiler without the JavaScript compiler API. OR3 imports that API in shared/dev/local-packages.ts and several provider, documentation and plugin-compatibility generators. Vue/Volar tooling also needs the API, and latest typescript-eslint 8.72.0 declares TypeScript >=4.8.4 <6.1.0. A blanket 5.9.3 to 7.0.2 bump would break these consumers.

If compiler modernization is desired, assess the 6.x compatibility line first. TypeScript 6 changes defaults for types/rootDir and deprecates baseUrl; OR3's tsconfig.eslint.json and tsconfig.eslint.extensions.json still set baseUrl. A side-by-side native compiler is a distinct project, not a routine dependency update. [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [TypeScript 6 migration](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).

### es-module-lexer: direct code incompatibility in plugin validation

OR3's unresolvedBareImports() in server/admin/plugins/package-client-entry.ts awaits init as a promise and reads entry.n. Version 3 requires init() and changes full-build records to descriptive fields such as specifier with tagged variants. An unchanged runtime consumer could skip the bare-import checks because entry.n is undefined. Preserve the fail-closed validation contract when migrating. The minimal entry point retains shorter record fields but still needs initialization changes. **2.3.2 is the smaller update now.** [Upstream migration details](https://github.com/guybedford/es-module-lexer#export-analysis).

### Nuxt, Vue, Router and UI: compatible candidates with coordination requirements

Nuxt 4.6.2 requires Node ^22.22.3 / ^24.15.0 / >=26.0.0; current Nuxt accepts Node 24.11+. This checkout's Node 24.22.0 passes, while the broad project engine >=24 does not communicate the new floor. Check the exact pinned container runtime before adopting it. Nuxt 4.6 brings CLI v4, changed generated type configuration and an optional nuxt/server API. Existing h3 imports remain supported; mixing the new event shape with old helpers is unsafe. [Nuxt release](https://github.com/nuxt/nuxt/releases/tag/v4.6.0), [npm engine metadata](https://registry.npmjs.org/nuxt/4.6.2).

New Nuxt depends on Vue >=3.5.44 and Router >=5.4.0. New Nuxt UI depends on Kit/schema >=4.6.1 and Reka exactly 2.11.0, so bumping only UI while retaining the old exact root pins risks duplicate framework/UI packages. Router 5.4 lists an experimental breaking change: query values become arrays. No experimental-router import was found in OR3, but its changed scroll restoration deserves navigation checks. UI/Reka notes include focus, keyboard, overlays and lazy mounting changes; validate existing theme overrides and mobile interactions. [Router notes](https://github.com/vuejs/router/releases/tag/v5.4.0), [UI notes](https://github.com/nuxt/ui/releases/tag/v4.12.0), [Reka notes](https://github.com/unovue/reka-ui/releases/tag/v2.11.0).

### TipTap: current overrides would defeat the new package requirements

All ten direct @tiptap packages should move to 3.32.0 together because peers are exact-version coupled. @tiptap/pm 3.32.0 requires prosemirror-model ^1.25.12, prosemirror-transform ^1.12.2 and prosemirror-view ^1.42.6. OR3 overrides them to older 1.25.11 / 1.12.0 / 1.42.3. Leaving those overrides in place would force versions below the new minimums. The release also changes list conversion and editor schema behavior. Validate persisted document round-trips, tables, mentions, lists, undo and Markdown import/export. [TipTap release](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0), [exact dependency metadata](https://registry.npmjs.org/@tiptap%2fpm/3.32.0).

### KaTeX: user-visible CSS and strict-mode changes

Version 0.17 changes the internal extension API; 0.18 prefixes internal CSS classes; 0.19 changes missing-glyph warnings/errors and requires strict callbacks to return explicit values. The current root KaTeX is 0.16.47, while streamdown-vue already has a nested 0.18.7 and other Markdown dependencies retain 0.16.27. ChatMessage.vue imports the root CSS, so align CSS with the renderer during qualification and check every vulnerable nested copy. The reported trust-bypass advisory affects versions below 0.18.2. [Migration guide](https://katex.org/docs/migration), [advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7).

### Vitest, jsdom and fake-indexeddb: separate test-infrastructure migrations

Vitest 5 enables clearMocks by default, rejects hoisted mocking calls nested inside functions/blocks, changes full-name matching and shares Vite servers across eligible inline projects. OR3 already sets extends: true explicitly, so that new default is not itself a migration issue here. Coverage must match the runner exactly. **4.1.12 is an available hardening patch** for both packages before taking 5.0.5. [Vitest migration](https://vitest.dev/guide/migration/), [4.1.12 notes](https://github.com/vitest-dev/vitest/releases/tag/v4.1.12).

jsdom 25 to 30 crosses multiple majors: element.click() fires PointerEvent, selector/CSS behavior changes, virtual-console sendTo becomes forwardTo, and resource loading is redesigned. Latest requires Node 24.15+ on the 24.x line. fake-indexeddb 6 uses DOMException instead of ordinary Error and changes scheduling/Date handling. Upgrade these independently so failures remain attributable; qualify meaningful persistence, focus and DOM behaviors rather than rewriting assertions indiscriminately. [jsdom releases](https://github.com/jsdom/jsdom/releases), [fake-indexeddb 6 notes](https://github.com/dumbmatter/fakeIndexedDB/releases/tag/v6.0.0).

### Other behavior changes worth planning for

- **Playwright 1.64:** device descriptors now supply screen dimensions; JSX follows tsconfig; missing-snapshot update mode can pass; hidden iframes count as hidden. OR3 spreads Desktop Chrome in playwright.config.ts, so the screen change directly applies. Browser binaries must be refreshed when a later update is authorized. [Release notes](https://github.com/microsoft/playwright/releases/tag/v1.64.0).
- **VueUse 15:** removes templateRef and deprecated timer options, drops Node 20, changes SSE/IDB behavior and makes throttle trailing default true. OR3's HelpChat throttle already passes trailing/leading explicitly, reducing that particular impact. Check other composables and auto-imported APIs. [Release notes](https://github.com/vueuse/vueuse/releases/tag/v15.0.0).
- **gpt-tokenizer 4:** removes UMD and unpkg global builds. OR3's app/workers/tokenizer.worker.ts uses an ESM encode import, so that removal is unlikely to require an application API change. Verify token-count consistency and worker bundling. [4.0 notes](https://github.com/niieani/gpt-tokenizer/releases/tag/4.0.0).
- **ESLint 10:** changes config lookup, removes legacy config/context APIs and adjusts rules. OR3 already uses flat config and only a small explicit rule set, which reduces the migration surface. Latest parser/plugin peers permit ESLint 10 but exclude TypeScript 7. [Migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0).
- **Convex 1.47:** large index/schema operations can now require confirmation; the MCP envList tool returns names by default. Review deployment automation and provider type alignment; this does not authorize a backend migration or deployment. [Changelog](https://github.com/convex/convex-js/blob/main/CHANGELOG.md#1470).
- **vue-tsc 3:** language tooling changed substantially; Vue 2/class-component support is dropped in the 3.1 line. OR3 uses Vue 3, but still needs a compatible JavaScript TypeScript API and regenerated Nuxt types. [3.0 notes](https://github.com/vuejs/language-tools/releases/tag/v3.0.0).
- **Node/Bun types:** prefer @types/node 24.19.2 over 26.6.5 while supporting Node 24. Keep bun-types aligned with pinned Bun 1.3.14 until a coordinated runtime/CI change. Types alone must not imply APIs the supported runtime lacks.

## Complete root update list

“Allowed” only describes the current semver declaration. Exact pins and 0.x ranges can block updates that are otherwise available. “Low” is a compatibility assessment, not a claim of tested safety. Every package below has a verified newer stable registry release.

### Runtime dependencies — 24 packages

| Package | Locked | Latest stable | Allowed by present declaration | Assessment |
| --- | --- | --- | --- | --- |
| [@nuxt/ui](https://github.com/nuxt/ui/releases/tag/v4.12.0) | 4.11.1 | 4.12.0 | No | Coordinated: No declared stable API break found; depends on Reka 2.11.0 and newer Kit/schema. Recheck themes, overlays and focus. |
| [@openrouter/sdk](https://github.com/OpenRouterTeam/typescript-sdk/releases) | 1.2.145 | 1.4.25 | Yes | Review: Same major; generated release notes show additive changes, but do not fully describe 1.3 internals. Validate deep imports, types, OAuth and streaming. |
| [@tiptap/core](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/extension-image](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/extension-list](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/extension-mention](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/extension-table](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/extensions](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/pm](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/starter-kit](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/suggestion](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@tiptap/vue-3](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0) | 3.31.3 | 3.32.0 | Yes | Coordinated: All 10 direct TipTap packages must move together; raise the three ProseMirror overrides to satisfy new minimums. |
| [@vueuse/core](https://github.com/vueuse/vueuse/releases/tag/v15.0.0) | 14.4.0 | 15.0.0 | No | Major: Removes APIs/timer options; changes throttling and SSE/IDB behavior. Existing HelpChat throttle passes edge options explicitly. |
| [es-module-lexer](https://github.com/guybedford/es-module-lexer#export-analysis) | 2.3.1 | 3.0.4 | No | Hold major: 3.x changes init and import records used by plugin validation. Prefer 2.3.2 until code is migrated. |
| [exsolve](https://registry.npmjs.org/exsolve/1.1.3) | 1.1.1 | 1.1.3 | Yes | Low / limited notes: Patch candidate; 1.1.2 documents cache-lifetime fixes. No version-specific 1.1.3 release notes found. |
| [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer/releases/tag/4.0.0) | 3.4.0 | 4.1.0 | No | Major, narrow impact: 4.0 removes UMD/unpkg global builds; OR3 uses an ESM worker import. Verify worker loading and token counts. |
| [katex](https://katex.org/docs/migration) | 0.16.47 | 0.19.0 | No | Breaking behavior: 0.18 renames internal CSS classes; 0.19 changes strict handling/types. Coordinate root CSS and renderer copies. |
| [lru-cache](https://registry.npmjs.org/lru-cache/11.5.3) | 11.5.2 | 11.5.3 | Yes | Low: Patch within 11.x. No engine conflict with Node 24; verify cache consumers. |
| [nuxt](https://github.com/nuxt/nuxt/releases/tag/v4.6.0) | 4.5.2 | 4.6.2 | No | Coordinated: Node 24 floor rises to 24.15.0; CLI v4 and server/type changes. Update with Kit, Vue and router; see details. |
| [reka-ui](https://github.com/unovue/reka-ui/releases/tag/v2.11.0) | 2.10.4 | 2.11.0 | No | Coordinated: No declared breaking section found; keyboard/focus/menu behavior changes. Pair with Nuxt UI 4.12.0. |
| [streamdown-vue](https://registry.npmjs.org/streamdown-vue/1.0.35) | 1.0.33 | 1.0.35 | No | Review / limited notes: Patch candidate; peers unchanged and Markdown/icon dependencies move. No tagged changelog available; validate chat rendering. |
| [vue](https://github.com/vuejs/core/blob/main/CHANGELOG.md) | 3.5.43 | 3.5.44 | No | Low / coordinated: 3.5 patch fixes; keep runtime/compiler packages deduplicated. Required at >=3.5.44 by new Nuxt. |
| [vue-router](https://github.com/vuejs/router/releases/tag/v5.4.0) | 5.3.1 | 5.4.0 | Yes | Breaking experimental API: 5.4 normalizes experimental query values to arrays; also changes default scroll restoration. No experimental-router import found. |
| [zod](https://registry.npmjs.org/zod/4.6.7) | 4.6.5 | 4.6.7 | Yes | Low: 4.x patch. No explicit migration note found; validate typed schemas and serialized error handling. |

### Development dependencies — 26 packages

| Package | Locked | Latest stable | Allowed by present declaration | Assessment |
| --- | --- | --- | --- | --- |
| [@iconify-json/carbon](https://registry.npmjs.org/@iconify-json%2fcarbon/1.2.28) | 1.2.27 | 1.2.28 | Yes | Low / data: Icon data update. Check referenced icon identifiers for removals/renames; not a runtime API migration. |
| [@iconify-json/lucide](https://registry.npmjs.org/@iconify-json%2flucide/1.2.147) | 1.2.134 | 1.2.147 | Yes | Low / data: Icon data update. Check referenced icon identifiers for removals/renames; not a runtime API migration. |
| [@iconify-json/pixelarticons](https://registry.npmjs.org/@iconify-json%2fpixelarticons/1.2.10) | 1.2.9 | 1.2.10 | Yes | Low / data: Icon data update. Check referenced icon identifiers for removals/renames; not a runtime API migration. |
| [@iconify-json/simple-icons](https://registry.npmjs.org/@iconify-json%2fsimple-icons/1.2.100) | 1.2.98 | 1.2.100 | Yes | Low / data: Icon data update. Check referenced icon identifiers for removals/renames; not a runtime API migration. |
| [@iconify-json/tabler](https://registry.npmjs.org/@iconify-json%2ftabler/1.2.42) | 1.2.38 | 1.2.42 | Yes | Low / data: Icon data update. Check referenced icon identifiers for removals/renames; not a runtime API migration. |
| [@nuxt/kit](https://github.com/nuxt/nuxt/releases/tag/v4.6.2) | 4.5.2 | 4.6.2 | No | Coordinated: Keep equal to Nuxt. New Nuxt UI also requires Kit >=4.6.1. |
| [@playwright/test](https://github.com/microsoft/playwright/releases/tag/v1.64.0) | 1.63.0 | 1.64.1 | Yes | Breaking behavior: Device screen emulation, JSX compilation, missing-snapshot results and hidden iframe visibility change. |
| [@types/better-sqlite3](https://registry.npmjs.org/@types%2fbetter-sqlite3/9.6.0) | 7.6.13 | 9.6.0 | No | Types review: Types-only major; may surface compile errors. Does not update or migrate SQLite runtime/data. |
| [@types/node](https://registry.npmjs.org/@types%2fnode/26.6.5) | 24.13.5 | 26.6.5 | No | Use 24.x: Prefer 24.19.2, allowed by current range. 26.6.5 describes a newer runtime than the Node 24 baseline. |
| [@typescript-eslint/eslint-plugin](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.0) | 8.65.0 | 8.72.0 | Yes | Coordinated: Update with parser; rule/parser fixes can change lint results. Latest peer excludes TypeScript 7. |
| [@typescript-eslint/parser](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.0) | 8.65.0 | 8.72.0 | Yes | Coordinated: Update with eslint-plugin. Latest peer allows ESLint 10, but TypeScript must remain <6.1.0. |
| [@vitejs/plugin-vue](https://registry.npmjs.org/@vitejs%2fplugin-vue/6.0.10) | 6.0.9 | 6.0.10 | No | Low: 6.x patch; latest peers include existing Vue 3.5 and Vite 8. |
| [@vitest/coverage-v8](https://vitest.dev/guide/migration/) | 4.1.11 | 5.0.5 | No | Hold major: Prefer 4.1.12 with Vitest 4.1.12 first. Coverage provider must match Vitest exactly. |
| [bun-types](https://registry.npmjs.org/bun-types/1.4.3) | 1.3.14 | 1.4.3 | No | Hold separately: Keep 1.3.14 while packageManager/CI/runtime stay on Bun 1.3.14; upgrade runtime and types together. |
| [convex](https://github.com/convex/convex-js/blob/main/CHANGELOG.md#1470) | 1.46.0 | 1.47.0 | No | CLI behavior: Large-index/schema deployment checks add confirmation; envList MCP tool hides values by default. Qualify optional provider. |
| [eslint](https://eslint.org/docs/latest/use/migrate-to-10.0.0) | 9.39.5 | 10.13.0 | No | Major: Config lookup and rule/plugin APIs change. Already using flat config; latest TS-eslint supports ESLint 10. |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB/releases/tag/v6.0.0) | 5.0.2 | 6.2.6 | No | Major: DOMException replaces Error in IDB failures; scheduling and cross-realm Date behavior change. |
| [jsdom](https://github.com/jsdom/jsdom/releases) | 25.0.1 | 30.1.3 | No | Major migration: 25 to 30 crosses DOM/event/CSS/resource APIs; Node 24.15+ needed. Update separately from test runner. |
| [react](https://registry.npmjs.org/react/19.3.1) | 19.3.0 | 19.3.1 | Yes | Low / paired: Patch candidate for SDK React adapters. Keep paired with react-dom. |
| [react-dom](https://registry.npmjs.org/react-dom/19.3.1) | 19.3.0 | 19.3.1 | Yes | Low / paired: Latest peer requires React ^19.3.1; update together. |
| [rolldown](https://github.com/rolldown/rolldown/releases/tag/v1.2.15) | 1.2.9 | 1.2.15 | No | Review: Patch build-tool changes; latest was published on audit day. Qualify bundling/HMR and avoid automatic rollout. |
| [terser](https://github.com/terser/terser/blob/master/CHANGELOG.md) | 5.44.1 | 5.51.2 | No | Review: Many minifier fixes since current pin; inspect production output and workers. No major API migration identified. |
| [typescript](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) | 5.9.3 | 7.0.2 | No | Blocked as direct replacement: 7.0 lacks compiler JS API; OR3 scripts and Vue/lint tooling require it. Consider 6.x as a separate migration. |
| [vite](https://github.com/vitejs/vite/releases/tag/v8.3.5) | 8.3.0 | 8.3.5 | No | Priority patch: 8.3.0 is in launch-editor advisory ranges; 8.3.5 is outside them. Recheck dev launcher/HTTPS and production build. |
| [vitest](https://vitest.dev/guide/migration/) | 4.1.11 | 5.0.5 | No | Hold major: 5 changes mock defaults, hoisting and project/server semantics. 4.1.12 is a smaller hardening update. |
| [vue-tsc](https://github.com/vuejs/language-tools/releases/tag/v3.0.0) | 2.2.12 | 3.3.13 | No | Major tooling: 3.x changes Vue language tooling and drops Vue 2/class components; OR3 is Vue 3. Keep compiler API compatibility. |

## Explicit transitive overrides

These are additional to the 50 direct updates. Existing overrides prevent an ordinary lock refresh from moving them.

| Override | Current | Newer candidate | Recommendation |
| --- | --- | --- | --- |
| fast-uri | 3.1.7 | 3.1.9 on current major; latest 4.2.3 | Security patch first. Avoid unnecessary 4.x migration. |
| prosemirror-model | 1.25.11 | 1.25.12 | Required by TipTap 3.32.0 minimum. |
| prosemirror-transform | 1.12.0 | 1.12.2 | Required by TipTap 3.32.0 minimum. |
| prosemirror-view | 1.42.3 | 1.42.6 | Required by TipTap 3.32.0 minimum. |
| undici | 8.11.2 | 8.12.3 | Review HTTP/stream/cancellation behavior. New Nuxt requires >=8.12.1, above current override. Version-specific release notes were unavailable. |
| h3 | 1.15.11 | 2.0.7 | Hold major. Nitro 2 and current provider contracts own the 1.x integration; migrate with its framework owner. |
| vite-plugin-pwa | 1.3.0 | 2.0.0 | Hold wrapper contract. @vite-pwa/nuxt 1.1.1 still requests ^1.2.0; v2 changes assets-generator peer support. |

source-map-js 1.2.2 and ufo 1.6.4 are already current. The vue override follows the root vue dependency. Nuxt's own new dependency requirements reinforce the need to review overrides rather than retaining them mechanically. [Nuxt metadata](https://registry.npmjs.org/nuxt/4.6.2), [PWA v2 notes](https://github.com/vite-pwa/vite-plugin-pwa/releases/tag/v2.0.0), [PWA wrapper metadata](https://registry.npmjs.org/@vite-pwa%2fnuxt/1.1.1).

## Security-related transitive updates

The highest-severity findings need context:

- Optional **Clerk**: @clerk/nuxt 1.13.26 and @clerk/shared 3.47.2 match a critical middleware route-protection advisory, with additional authorization-check advisories in sibling packages. The current provider's ^1.13.12 range permits @clerk/nuxt 1.13.34, which requests patched backend 2.33.8, shared 3.48.0 and Vue 1.17.26. This can be addressed within the existing major; no provider major migration is required. Clerk is absent from the managed fixed profile. [Critical advisory](https://github.com/advisories/GHSA-vqx2-fgx2-5wq9), [authorization advisory](https://github.com/advisories/GHSA-w24r-5266-9c3c), [patched metadata](https://registry.npmjs.org/@clerk%2fnuxt/1.13.34).
- **simple-git / argv-parser** and **shell-quote**: critical command-execution advisories appear in the non-dev lock through Nuxt DevTools and launch-editor. OR3 disables DevTools in production; package presence alone does not establish a production endpoint. simple-git 4 removes default/promise/gitP imports and changes environment/option handling, so forcing it over a parent's 3.x range is unsafe. Prefer an owning-parent update or removal of the unused tooling path. shell-quote's fix also starts rejecting previously accepted unsafe tokens. [simple-git advisory](https://github.com/advisories/GHSA-x6jw-m9v5-85vh), [v4 migration](https://github.com/steveukx/git-js/releases/tag/simple-git%404.0.0), [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
- **Markdown, sanitization and document parsing**: Markdown-it is reached through tiptap-markdown; DOMPurify through streamdown-vue → Mermaid; sprintf-js through mammoth → argparse. These are more directly relevant to user-provided content than a generic tooling vulnerability count. Markdown-it 14.3.3 fixes the reported parsing DoS on the existing major. DOMPurify advisories require particular IN_PLACE usage; actual application exposure was not established. [Markdown-it advisory](https://github.com/advisories/GHSA-gfr2-rv44-r23c), [DOMPurify advisory](https://github.com/advisories/GHSA-6688-9rhm-gjv2).
- **No patched release found** for braces, node-forge and sprintf-js: the registry latest versions still fall within the reported vulnerable ranges. This needs parent-path/reachability review or an upstream fix, not a claim that every finding can be cleared by updating the named package.

The following table covers all 45 package names flagged across either audit. The two version columns identify where the affected versions were actually found; an em dash means that graph was not flagged. Proposed targets are research candidates and must be resolved and re-audited when updates are authorized. A fixed top-level copy does not fix stale nested copies. Each package links to a representative advisory; packages can have multiple advisories.

| Package | Affected source Bun versions | Affected fixed-profile non-dev versions | Highest severity | Candidate / constraint |
| --- | --- | --- | --- | --- |
| [@babel/plugin-transform-modules-systemjs](https://github.com/advisories/GHSA-fv7c-fp4j-7gwp) | 7.28.5 | — | high | 7.29.8 through parent; avoid forcing Babel 8 |
| [@clerk/backend](https://github.com/advisories/GHSA-w24r-5266-9c3c) | 2.33.0 | — | high | 2.33.8 via Clerk Nuxt 1.13.34 |
| [@clerk/nuxt](https://github.com/advisories/GHSA-w24r-5266-9c3c) | 1.13.26 | — | critical | 1.13.34 on current major |
| [@clerk/shared](https://github.com/advisories/GHSA-w24r-5266-9c3c) | 3.47.2 | — | critical | 3.48.0 via Clerk Nuxt 1.13.34 |
| [@clerk/vue](https://github.com/advisories/GHSA-w24r-5266-9c3c) | 1.17.18 | — | high | 1.17.26 via Clerk Nuxt 1.13.34 |
| [@humanfs/node](https://github.com/advisories/GHSA-p498-v437-472g) | 0.16.7 | — | moderate | >=0.16.8 via lint parent |
| [@isaacs/brace-expansion](https://github.com/advisories/GHSA-7h2j-956f-4vf2) | 5.0.0 | — | high | 5.0.1 |
| [@simple-git/argv-parser](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | 1.1.1 | 1.1.1 | critical | 2.0.1 through simple-git parent migration |
| [baseline-browser-mapping](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | 2.9.11 | — | moderate | 2.11.30; refresh nested copies |
| [brace-expansion](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | 1.1.12, 5.0.7, 2.0.2 | 1.1.18, 2.1.4, 5.0.9 | high | 1.1.21 / 2.1.7 / 5.0.12 for respective branches |
| [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 3.0.3 | 3.0.3 | high | No patched registry release found (latest 3.0.3 still flagged) |
| [browserslist](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | 4.28.1 | — | high | 4.29.4; refresh nested copies |
| [defu](https://github.com/advisories/GHSA-737v-mqg7-c878) | 6.1.4 | — | high | 6.1.7; refresh nested copies |
| [devalue](https://github.com/advisories/GHSA-r9w8-h9r3-54w4) | 5.9.2 | — | high | 5.9.4 on current branch; Nuxt 4.6 owns its move to 6.x |
| [dompurify](https://github.com/advisories/GHSA-p98j-92pf-mc4p) | 3.4.15 | 3.4.13 | low | 3.4.17 |
| [esbuild](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | — | 0.27.7 | low | 0.28.2 through parent; crosses a 0.x minor boundary |
| [fast-uri](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) | 3.1.7 | 3.1.7 | moderate | 3.1.9; change existing exact override |
| [fast-xml-builder](https://github.com/advisories/GHSA-5wm8-gmm8-39j9) | 1.0.0 | — | high | 1.3.1 |
| [fast-xml-parser](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) | 5.4.1 | — | high | 5.11.2 |
| [flatted](https://github.com/advisories/GHSA-25h7-pfq9-p65f) | 3.3.3 | — | high | 3.4.4 |
| [form-data](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) | 4.0.5 | — | high | 4.0.6 |
| [js-cookie](https://github.com/advisories/GHSA-qjx8-664m-686j) | 3.0.5 | — | high | 3.0.8 |
| [js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | — | 4.3.1 | high | 4.3.2 on current major; avoid forcing 5.x |
| [katex](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | 0.16.47, 0.16.27 | 0.16.47 | low | 0.19.0 with migration; patched versions start at 0.18.2 |
| [kysely](https://github.com/advisories/GHSA-pv5w-4p9q-p3v2) | 0.28.11 | — | high | >=0.28.17 via owning provider; review before 0.29.x |
| [launch-editor](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | 2.14.1 | 2.14.1 | high | 2.14.2 through dev-tool parent; recheck Windows/editor handling |
| [linkify-it](https://github.com/advisories/GHSA-22p9-wv53-3rq4) | 5.0.0 | — | high | 6.1.0 through Markdown parent; major boundary |
| [lodash](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | 4.17.21 | — | high | 4.18.1 |
| [lodash-es](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | 4.17.22 | — | high | 4.18.1 |
| [markdown-it](https://github.com/advisories/GHSA-38c4-r59v-3vqw) | 14.1.0 | 14.3.0 | high | 14.3.3 on existing major; avoid unnecessary 15.x jump |
| [minimatch](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | 9.0.5, 5.1.6, 10.1.1 | — | high | Refresh compatible installed branches through parents |
| [nanoid](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | 3.3.16, 3.3.11 | — | high | 3.3.20 for affected 3.x copies; avoid forcing 6.x |
| [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | 1.4.0 | 1.4.0 | high | No patched registry release found (latest 1.4.0 still flagged) |
| [picomatch](https://github.com/advisories/GHSA-3v7f-55p6-f55p) | 4.0.3, 2.3.1 | — | high | 4.0.7 for 4.x; refresh older branches through parents |
| [postcss](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | 8.5.21, 8.5.6 | — | high | 8.5.31; refresh nested copies |
| [postcss-selector-parser](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | 6.0.10, 7.1.1, 7.1.4 | — | moderate | 7.1.7 via parent; old 6.x copy needs parent review |
| [shell-quote](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) | 1.10.0 | 1.10.0 | critical | 1.12.0; fix rejects unsafe input that previously passed |
| [simple-git](https://github.com/advisories/GHSA-858h-whjf-mvg5) | 3.36.0 | 3.36.0 | critical | 4.0.2 via parent; breaking import/env/option changes |
| [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | 1.0.3 | 1.0.3 | moderate | No patched registry release found (latest 1.1.3 still flagged) |
| [svgo](https://github.com/advisories/GHSA-4vpr-x523-8j87) | 4.0.2 | — | high | 4.1.0 |
| [tar](https://github.com/advisories/GHSA-34x7-hfp2-rc4v) | 7.5.2 | — | critical | 7.5.22 |
| [tmp](https://github.com/advisories/GHSA-ph9p-34f9-6g65) | 0.2.5 | — | high | 0.2.7 |
| [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | 11.1.0 | — | moderate | Update affected 11.x through parent; avoid forcing 14.x |
| [vite](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | 8.3.0, 8.1.5 | 8.3.0 | high | 8.3.5; update direct pin and refresh nested copies |
| [ws](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) | 8.19.0 | — | high | 8.22.0 through optional Convex graph |

Selected verified dependency paths in the production lock:

- or3-chat → nuxt@4.5.2 → @nuxt/devtools@3.4.1 → simple-git@3.36.0
- or3-chat → nuxt@4.5.2 → @nuxt/devtools@3.4.1 → launch-editor@2.14.1 → shell-quote@1.10.0
- or3-chat → nuxt@4.5.2 → @nuxt/cli@3.37.0 → listhen@1.10.1 → node-forge@1.4.0
- or3-chat → tiptap-markdown@0.9.0 → markdown-it@14.3.0
- or3-chat → streamdown-vue@1.0.33 → mermaid@11.16.1 → dompurify@3.4.13
- or3-chat → mammoth@1.13.0 → argparse@1.0.10 → sprintf-js@1.0.3
- or3-chat → ajv@8.20.0 → fast-uri@3.1.7
- or3-chat → nuxt@4.5.2 → @nuxt/nitro-server@4.5.2 → nitropack@2.13.4 → globby@16.2.4 → micromatch@4.0.8 → braces@3.0.3

## Already current and adjacent packages

The other 40 registry dependencies in the root manifest already match their stable latest tag, including the storage/auth provider packages, Dexie, better-sqlite3, PDF.js, Tailwind and @or3/secrets. This does not establish that their transitive graphs are vulnerability-free.

- @cfworker/json-schema 4.1.1
- @iconify-json/solar 1.2.13
- @noble/hashes 2.4.0
- @or3/secrets 0.1.1
- @orama/orama 3.1.18
- @tailwindcss/typography 0.5.20
- @types/cross-spawn 6.0.6
- @types/jsonwebtoken 9.0.10
- @types/react 19.3.0
- @types/react-dom 19.3.0
- @types/semver 7.8.0
- @types/spark-md5 3.0.5
- @types/streamsaver 2.0.5
- @vite-pwa/nuxt 1.1.1
- @vue/test-utils 2.5.1
- ajv 8.20.0
- bcryptjs 3.0.3
- better-sqlite3 13.0.3
- cross-spawn 7.0.6
- dexie 4.4.6
- dexie-export-import 4.4.1
- fflate 0.8.3
- jsonwebtoken 9.0.3
- mammoth 1.13.0
- or3-provider-basic-auth 0.0.14
- or3-provider-clerk 0.0.9
- or3-provider-convex 0.0.19
- or3-provider-fs 0.0.13
- or3-provider-s3 0.0.12
- or3-provider-sqlite 0.0.19
- or3-scroll 0.1.3
- pathe 2.0.3
- pdfjs-dist 6.4.299
- semver 7.8.5
- spark-md5 3.0.2
- streamsaver 2.0.6
- tailwindcss 4.3.3
- tiptap-markdown 0.9.0
- tsx 4.23.15
- vite-bundle-visualizer 1.2.1

@or3/plugin-sdk is linked to the local package at version 2.2.0. The official plugins and examples declare compatible 2.x SDK ranges; templates use compatibility ranges rather than exact latest-version pins. Those lower bounds do not need rewriting simply because a newer compatible package exists. The SDK's React/Vue/TypeScript development dependencies overlap the root inventory. create-or3-chat adds only cross-spawn, already current. The cloud/skills packages add no separate registry dependency set.

The OpenClaw bridge is a separate compatibility contract: its peer range is >=2026.7.1-2 <2026.8.0, while npm latest is 2026.10.5. The host is not installed by the root manifest, so this is not counted in the 50 updates. Do not widen that range without qualifying the bridge against the newer host.

## Validation and limits

- Ran read-only registry/outdated queries, Bun advisory audit, production-lock advisory matching and dependency-path tracing.
- bun run check:lock-drift passed: the committed production lock matches the pruned fixed-profile manifest.
- SHA-256 checks confirmed package.json, bun.lock and package-lock.json were unchanged by this audit. Existing checkout work was preserved.
- No upgrade compatibility tests or builds were run because no package versions were changed. Suggested future validation: targeted affected suites and type checks; SSR and static build wrappers for the framework/tooling batch; existing plugin compatibility checks for lexer/SDK changes; relevant browser journeys for editor, UI, navigation and rendering changes. Re-audit both resulting locks after resolution.
- Version availability and major migration notes were checked against registry metadata and primary upstream sources. Some patch releases (notably streamdown-vue 1.0.35, exsolve 1.1.3 and undici 8.12.3) lacked accessible version-specific release notes. Their rows explicitly retain that uncertainty. Metadata-only or brief generated release notes cannot prove the absence of a breaking change.
- This is a JavaScript dependency/update assessment. It does not audit OS/container CVEs, every package-manager/tool pin, licensing, every newer transitive release, live deployment reachability, or application-level security.
