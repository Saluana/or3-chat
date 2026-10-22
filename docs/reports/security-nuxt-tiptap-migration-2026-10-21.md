# Security patches and Nuxt/TipTap migration — 2026-10-21

Implemented in branch `codex/security-nuxt-tiptap`, in a new managed worktree. Chat and Cloud application versions are unchanged. All six provider patch releases were subsequently published and pinned by Chat; see the publication receipt below. No running deployment was updated.

## Coordinated upgrades

| Dependency | Previous resolved version | New version |
| --- | --- | --- |
| Nuxt / direct Nuxt Kit | 4.5.2 | 4.6.2 |
| Nuxt UI | 4.11.1 | 4.12.0 |
| Vue | 3.5.43 | 3.5.44 |
| Vue Router | 5.3.1 | 5.4.0 |
| Reka UI | 2.10.4 | 2.11.0 |
| TipTap release packages | 3.31.3 | 3.32.0 |
| ProseMirror model / transform / view overrides | 1.25.11 / 1.12.0 / 1.42.3 | 1.25.12 / 1.12.2 / 1.42.6 |
| Undici override | 8.11.2 | 8.12.3 |
| Vite | 8.3.0 | 8.3.5 |
| Vitest / coverage-v8 | 4.1.11 | 4.1.12 |
| KaTeX | 0.16.47, with older nested copies | 0.19.0 throughout |

The initial Nuxt migration raised the Node minimum to 24.15.0 and was validated using an isolated Node 24.22.0 installation and Bun 1.3.14. The subsequent Node security work below supersedes that minimum and updates the previously pinned Node 24.21.0 build image. The template generator inherits the host's engine declaration.

Nuxt UI, Vue and Reka were aligned to avoid incompatible framework copies. All TipTap release packages resolve to 3.32.0; `@tiptap/y-tiptap` has its own version scheme. The ProseMirror overrides now satisfy TipTap's updated minimum ranges. Nitro 2 and the H3 1 override remain in place; this does not adopt the experimental server builder or change provider/data contracts. See the [Nuxt release notes](https://github.com/nuxt/nuxt/releases/tag/v4.6.0) and [TipTap release notes](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0).

KaTeX's internal CSS classes changed across this migration. One patched renderer is now enforced across Markdown and Mermaid and shared with the root stylesheet. OR3 has no custom selectors or sanitizer allowlists targeting the renamed internal classes. The installed streaming Markdown renderer passes inline/block math checks with the new prefixed classes. See the [KaTeX migration guide](https://katex.org/docs/migration).

## Security fixes

The lockfiles refresh compatible transitive ranges while preserving the chosen direct versions. The large lockfile diffs include dependency deduplication and removal of obsolete subtrees. Existing ranges also resolved the small exsolve 1.1.3 and lru-cache 11.5.3 patches. Unrelated major migrations, including TypeScript 7, es-module-lexer 3, Vitest 5 and VueUse 15, were not adopted.

Explicit security constraints are recorded in `package.json`:

- fast-uri 3.1.9, DOMPurify 3.4.17 and markdown-it 14.3.3.
- Clerk Nuxt 1.13.34 on the existing major; it brings backend 2.33.8, shared 3.48.0 and Vue 1.17.26. The initial migration retained the OR3 Clerk provider version; its subsequent Node patch release is recorded below. No live external Clerk sign-in was exercised.
- KaTeX follows the root version to replace vulnerable nested 0.16 copies and coordinate renderer/CSS versions.
- postcss-selector-parser 7.1.7 replaces Typography's exact 6.0.10 pin. The reviewed v7 change concerns safe insertion during iteration; Typography's caller traverses copied node arrays. Both application builds pass with this override. The [upstream changelog](https://github.com/postcss/postcss-selector-parser/blob/main/CHANGELOG.md) and [advisory](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf) describe the changes and fixes.
- esbuild 0.28.2 replaces Fontless's older 0.27 range and aligns build tooling. The reviewed 0.28 changes include integrity verification for fallback binary downloads; normal bundling APIs remain usable by these callers. See the [0.28 release notes](https://github.com/evanw/esbuild/releases/tag/v0.28.0) and [security advisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).

Other resolved fixes include compatible refreshes of Babel's SystemJS transform, brace-expansion, Browserslist, defu, XML tooling, flatted, form-data, Kysely, lodash, minimatch, nanoid, picomatch, PostCSS, shell-quote, tar, tmp and ws. Nuxt's newer DevTools graph removes simple-git and its vulnerable argument parser instead of forcing simple-git 4 underneath an older consumer.

## Node security follow-up

OR3 Chat, its Cloud installer, creator, SDK and SDK templates, skills package, and all six first-party providers now share **Node 24.22.1** as the tested baseline. Package engines require `^24.22.1`, permitting later Node 24 patches. Development `.node-version` files and all 38 explicit CI Node selections pin `24.22.1`. Nine Chat jobs previously depended on the runner's implicit Node; they now install the patched runtime explicitly. Bun remains pinned at 1.3.14.

This addresses the runtime update called for by the [October Node security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). The release fixes TLS hostname validation, Brotli decoding, DNS and other runtime issues; updating the npm Undici override alone does not replace Node's bundled native libraries or built-in fetch implementation. See the [Node 24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1/).

The application, operator and backup/restore fixture now use these verified multi-architecture base indexes:

| Base | Pinned index digest |
| --- | --- |
| `node:24-bookworm-slim` | `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205` |
| `gcr.io/distroless/nodejs24-debian13:nonroot` | `sha256:78f07ef1b5ea71ad7c055df15d0dd8997f2d288f9158623c4d4ae3d765b7d50d` |

Official Node image configs report 24.22.1 for amd64 and arm64. Distroless's Node layers were downloaded, their SHA-256 values checked against the manifests, and both ELF binaries independently inspected for the embedded `v24.22.1` version. Release qualification now compares the amd64 app and operator Node versions to the pinned CI runtime, and checks the arm64 app version before its existing native SQLite smoke. Those container checks have not been executed locally because Docker is stopped.

Generated Chat projects now contain `.node-version` and inherit the patched engine. Documentation and the Cloud installer's former Node 20 requirement are aligned. The existing release checker rejects engine drift between the host and bundled packages; a temporary negative control confirmed that restoring the installer's old `>=20` requirement fails this check. The existing SDK package-tree golden digest was refreshed because the starter's `package.json` bytes intentionally changed; the hashing algorithm and manifest digest are unchanged.

Provider changes live in separate `codex/node-24-security` worktrees beside Chat, each based on its refreshed `origin/main`. Their primary checkouts are untouched and package versions were not bumped:

| Provider | Current source version | Worktree |
| --- | --- | --- |
| Basic Auth | 0.0.14 | [or3-provider-basic-auth](/Users/brendon/.codex/worktrees/security-nuxt-tiptap/or3-provider-basic-auth) |
| Clerk | 0.0.9 | [or3-provider-clerk](/Users/brendon/.codex/worktrees/security-nuxt-tiptap/or3-provider-clerk) |
| Convex | 0.0.19 | [or3-provider-convex](/Users/brendon/.codex/worktrees/security-nuxt-tiptap/or3-provider-convex) |
| Filesystem | 0.0.13 | [or3-provider-fs](/Users/brendon/.codex/worktrees/security-nuxt-tiptap/or3-provider-fs) |
| S3 | 0.0.12 | [or3-provider-s3](/Users/brendon/.codex/worktrees/security-nuxt-tiptap/or3-provider-s3) |
| SQLite | 0.0.19 | [or3-provider-sqlite](/Users/brendon/.codex/worktrees/security-nuxt-tiptap/or3-provider-sqlite) |

All provider worktrees installed their own frozen dependencies. On Node 24.22.1, all six standalone typechecks, builds and existing test suites passed: **775 tests passed, 14 existing skips**. Chat's typecheck, SSR build and static build passed, along with **6,167 core tests** and one existing skip. The Cloud CLI passed 248 tests with four existing skips; the creator passed eight tests, including the generated version pin. Documentation, changed-file lint, package/lock alignment and all 11 workflow YAML files passed validation; 205 embedded shell scripts passed syntax checking. Detailed evidence is under `/private/tmp/or3-node-security-2026-10-21/`.

These are source and image-pin changes only. Published provider metadata and existing deployments are unchanged until the normal release/update workflow runs. Providers execute inside the host process, so a patched host image updates their actual Node runtime together. No live backend migration is required.

## Remaining advisories

The final registry advisory checks found the following in both graphs:

| Graph | Before: flagged package names / distinct advisory URLs | After |
| --- | --- | --- |
| Contributor Bun graph | 43 / 92 | 3 / 3 |
| Fixed-profile npm graph, non-dev entries | 15 / 24 | 3 / 3 |

The final checks examined 1,418 unique registry package names in Bun and 1,062 in the fixed-profile non-dev graph. Counts describe advisory matches, not confirmed exploitable application paths. The non-dev graph includes framework build/development tooling. Do not add the two rows together.

| Remaining package | Severity | Verified dependency path |
| --- | --- | --- |
| [braces 3.0.3](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | High | Nuxt → Nitro → globby → micromatch → braces |
| [node-forge 1.4.0](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | High | Nuxt → Nitro → listhen → node-forge |
| [sprintf-js 1.0.3](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | Moderate | mammoth → argparse → sprintf-js |

No patched registry release was found for these three packages. The latest sprintf-js 1.1.3 is also affected, so bumping to it would not resolve its advisory. These need upstream releases or a separately qualified dependency replacement; they have not been suppressed or described as fixed.

## Validation

All of the following passed:

- Final type check with disposable Basic Auth/SQLite configuration and paths.
- Core, app integration, plugin compatibility and release-policy lanes: **698 files, 6,349 passing tests**, one existing skip.
- Four isolated Chromium journeys: streamed chat persistence; document word counts across paragraphs, hard breaks and tables; slash-menu heading insertion; document autosave and restoration after reload.
- New compatibility cases cover nested bullet-to-task-list conversion, valid document schema, Markdown export, undo/redo, and inline/block math rendering.
- SSR build, static Cloud-disabled build, and the production plugin boundary checks emitted by both build wrappers. A final clean-install SSR build also passed.
- Plugin compatibility ledger and public API/Nuxt import snapshots; no snapshot regeneration was needed.
- Initializer checks: 8 passing tests. Existing stale Basic Auth version assertions were corrected to read the canonical qualification file after reproducing their failure.
- Cloud release/package alignment and Cloud CLI tests: 248 passing tests, four existing skips.
- Changed-file lint, documentation checks, `git diff --check`, `bun install --frozen-lockfile --ignore-scripts`, and `bun run check:lock-drift`.
- The fixed-profile lock was generated with npm 11.6.2 through Bun, from the repository's pruned manifest. An isolated install repaired an omitted optional WASM dependency; **npm 11.6.2 `ci --dry-run --ignore-scripts` then passed**. The source manifest retains all optional providers; the production lock continues to exclude Clerk, Convex and S3.

Browser artifacts are under `test-results/security-nuxt-tiptap/`. Local validation logs and raw advisory results are under `/private/tmp/or3-security-migration/`.

Incremental Bun installation initially left an obsolete nested Reka package on disk after lock regeneration. A clean worktree installation removed it; all final browser and multi-project checks used that clean tree. Clean CI/managed installs use the committed locks.

Docker image build and container-runtime qualification were not run because the Docker daemon is unavailable locally. The initial dependency batch preserved image digests; the Node security follow-up above updates them after inspecting both architectures. Normal build warnings about duplicated existing auto-imports, third-party annotations and the existing rebuild-required trusted-host plugin status remain. This change does not qualify or enable that plugin path.

At the initial migration review, changes were uncommitted and no packages or images had been published. Provider publication and host alignment are recorded below. No live data was migrated, and the original checkout's dependency files were preserved.

## Computer UI follow-up

The upgraded worktree was started with the supported wrapper on Node 24.22.1:

```bash
bun run dev -- --or3-offline --host 127.0.0.1 --port 3137
```

The Computer plugin's in-app browser used the fresh `http://127.0.0.1:3137` origin. All records created during this pass are synthetic, local-only QA data. No existing browser workspace, cloud account, or production data was changed. The dev server and final document tab are left open for review.

The following interactive checks passed:

- Onboarding dismissal, chat composer typing, undo/redo, draft recovery after reload, and draft retention across tab/split navigation.
- Disconnected send shows the expected OpenRouter connection notice and preserves the draft. The public model catalog loaded 469 models; text filtering and model selection worked, and the chosen model remained selected later in the pass.
- Document creation and title editing, bold formatting, bullet lists, a 3-by-3 table with header cells, keyboard navigation between table cells, autosave, and restoration after repeated reloads. Rendered DOM checks confirmed the bold markup and table dimensions.
- Command-palette body-text search found the saved document, displayed its excerpt, and opened it with the keyboard.
- Project creation, brief display, project-scoped document creation, project activity, and workspace split creation/closure preserved the saved content.
- Dashboard and settings opened. Blank, Cyberpunk, and Retro themes activated, and light/dark switching worked. The fresh QA workspace was returned to Blank/dark.
- A synthetic 91-byte text upload appeared in Files with the correct preview, moved into recoverable Trash, and restored to Files. Browser file-picker automation paused unusually long before completing; upload performance is not qualified by this check.
- System prompt creation, title/body editing, library persistence, and selecting that saved prompt in chat worked.
- At 390-by-844 pixels, the prompt library, chat settings, composer, tabs, sidebar, project navigation, and document toolbar remained usable. The document viewport and content widths were both 390 pixels. The viewport override was reset afterward.

No browser warnings or errors were observed in the sampled diagnostics, including after the final reload. The server remained running without a runtime exception. Startup diagnostics include duplicate auto-import notices, stale Browserslist data, first-use `or3-scroll` dependency discovery, and a missing local `pixel` icon collection warning; no blocking UI failure was observed from these notices. This pass required no application code changes.

This is a local-first UI verification. Live paid AI generation, external provider sign-in, cloud synchronization/storage, and Docker execution were not exercised. The earlier isolated streaming journey and provider suites remain the automated coverage for those code paths; they do not substitute for a live external-service qualification.

Evidence: `/private/tmp/or3-node-security-2026-10-21/computer-ui/` contains desktop and mobile screenshots, the synthetic fixture, and the final browser diagnostics. The final desktop image is `desktop-document-final.png`; narrow-screen evidence includes `mobile-prompts.png`, `mobile-chat-settings.png`, and `mobile-document.png`.

## Streamdown and Zod patch follow-up

The npm registry's stable `latest` tags were checked on October 21, 2026:

| Package | Previous Chat version | Updated version |
| --- | --- | --- |
| streamdown-vue | 1.0.33 | **1.0.35** |
| zod | 4.6.5 | **4.6.7** |

The manifest preserves Streamdown's exact pin and Zod's compatible caret range. Both Chat lockfiles resolve these versions, with a single Zod 4.6.7 resolution throughout each graph. No permanent Zod override was added. The existing shared KaTeX override remains in effect.

The Basic Auth provider now requires Zod `^4.6.7`; its previous Bun resolution was 4.3.6. SQLite's exact development dependency moves from 4.6.5 to 4.6.7. Their Bun locks were refreshed. Basic Auth's npm lock was also regenerated and clean-install checked. That lock had stale root metadata for version 0.0.13 and better-sqlite3 12; it now matches the existing 0.0.14 manifest and its already-declared better-sqlite3 13.0.3 dependency. Provider versions were unchanged during this patch follow-up; the subsequent releases are recorded below. Convex's broad Zod 3/4 peer range remains compatible and does not need narrowing; the other providers have no direct Zod dependency to update.

The [Streamdown source comparison](https://github.com/Saluana/streamdown-vue/compare/1b4dbf6fe942ab4c890d2a4cf4d56d7c1cc31d94...f164c95072f2c1c3f43a7cf1b336e89a08b78b0f) adds optional lazy syntax-language loading, escaped code fallbacks while a grammar loads, and fixes for code/math preprocessing and incomplete streamed blocks. Existing Vue and TypeScript peer requirements remain satisfied. No API migration is required for OR3's current usage.

The [Zod source comparison](https://github.com/colinhacks/zod/compare/v4.6.5...v4.6.7) includes recursive record/JSON typing compatibility and one observable validation change: upper size bounds on arrays, sets and maps now reject oversized inputs before parsing their elements. Invalid oversized collections may therefore report fewer nested errors, and element transforms do not run on those rejected inputs. Valid inputs retain their existing behavior. No OR3 schema migration was needed.

Validation on Node 24.22.1 passed:

- Chat typecheck and production SSR build, including the production plugin boundary check.
- Chat core: **6,167 passing tests**, one existing skip, across 664 files.
- Basic Auth standalone typecheck, build and **72 passing tests** across 16 files.
- SQLite standalone typecheck, build and **242 passing tests**, 11 existing skips, across 14 files.
- Frozen Bun installs for all three changed projects; npm 11.6.2 clean-install dry runs for Chat's fixed-profile lock and Basic Auth's lock; Chat's lock-drift check.
- Two existing Chromium journeys: streamed reply persistence after reload, and rich Markdown tables/code with touch editing at 320-, 390-, 844- and 1920-pixel viewport widths. No browser error events were captured by the responsive journey. Screenshots are retained under `test-results/streamdown-zod/`.

The first build attempt used an unsupported storage-provider environment alias in the disposable validation helper. Selecting Filesystem through the documented `NUXT_PUBLIC_STORAGE_PROVIDER=fs` setting removed the unintended Convex initialization; the corrected build passed without application source changes.

The normal offline development server is running again at `http://127.0.0.1:3137/chat`. Computer verified the hydrated chat UI and retained draft after reload, with no new warnings or errors in the timestamp-filtered diagnostics. Historical logs included stale Vite module requests from the page during the server restart; the fresh reload completed cleanly. The final screenshot is `dev-app-reloaded.png` in the evidence directory.

Evidence is under `/private/tmp/or3-streamdown-zod-2026-10-21/`. This patch follow-up initially remained uncommitted. The subsequent provider publication and host alignment are recorded below; no application image was manually published.

## Provider publication and host alignment

All six patch releases were committed and published through their version-matching Git tags. Every publication workflow succeeded, including the Convex packaged-backend lifecycle and real S3/MinIO upload/download checks. Exact npm version endpoints, stable latest tags, downloadable tarballs, SHA-512 integrity and SHA-1 shasums were independently verified before Chat consumed them.

| Package | Published update | Release workflow |
| --- | --- | --- |
| or3-provider-basic-auth | 0.0.14 → **0.0.15** | [passed](https://github.com/Saluana/or3-provider-basic-auth/actions/runs/39694432312) |
| or3-provider-clerk | 0.0.9 → **0.0.10** | [passed](https://github.com/Saluana/or3-provider-clerk/actions/runs/39694431708) |
| or3-provider-convex | 0.0.19 → **0.0.20** | [passed](https://github.com/Saluana/or3-provider-convex/actions/runs/39694603408) |
| or3-provider-fs | 0.0.13 → **0.0.14** | [passed](https://github.com/Saluana/or3-provider-fs/actions/runs/39694434045) |
| or3-provider-s3 | 0.0.12 → **0.0.13** | [passed](https://github.com/Saluana/or3-provider-s3/actions/runs/39694741274) |
| or3-provider-sqlite | 0.0.19 → **0.0.20** | [passed](https://github.com/Saluana/or3-provider-sqlite/actions/runs/39694661412) |

The publication receipt is [provider-releases-2026-10-21.json](provider-releases-2026-10-21.json). SQLite source landed through [PR #13](https://github.com/Saluana/or3-provider-sqlite/pull/13); the release tag identifies the exact qualified source commit retained in that merge.

The root manifest, contributor Bun lock, fixed-profile npm lock, creator qualification inventory and source setup wizard now select the new published versions. Release-guide examples were updated. Chat and Cloud application versions are unchanged; this prepares an ordinary source merge rather than a stable Cloud release.

The actual published SQLite and Filesystem runtime files were compared with their preceding releases: all 88 SQLite runtime files and 20 Filesystem runtime files are byte-identical, including all 26 migration implementations. The offline backup inspector now qualifies SQLite 0.0.20 with Filesystem 0.0.14. Its existing positive/negative version test was updated first, reproduced the stale-profile failure, and passed after the production profile changed. Migration ordering, supported historical backups and storage layout are unchanged.

All six clean provider checkouts passed their existing typechecks, builds and tests (775 passing tests, 14 existing skips); Convex's separate release-only lane also passed 13 tests. Package archives were inspected. Two concurrent local archive commands exited without a diagnostic; each passed when rerun separately, without a source change. The tagged CI archives and publication gates all passed.

Chat's production lock refresh changed only the three active default providers and root version declarations. Its npm 11.6.2 clean-install dry run, frozen Bun install, lock-drift and provider-version checks passed. The unchanged optional WASM threads metadata was retained after npm omitted it during lock-only generation. Final host validation uses installed published providers with local source aliases disabled; its results accompany the merge review.

Provider release/verification evidence is retained under `/private/tmp/or3-provider-publish-2026-10-21/`.
