# Local explorer qualification

The host baseline is `fa0c06e34abb01f05f690ad20481f30d0e6be3a7` on `or3-cloud`.
The implementation worktree and the original `work` checkout were clean at
start. Host `AGENTS.md` applies. The cloud workspace has no parent
`AGENTS.md`.

Provider source is maintained independently. The remote HEADs at the start of
this work were SQLite `53d3a2df92d67e03a7ac30bcac2eb6fd7c8d4d96` and Convex
`1bbb62fcdee7fff93d5860a42782fc95b9a58e3e`. Neither sibling clone was present
at baseline. Provider readiness must be verified against its own checkout and a
disposable backend. Convex needs a deployed matching template for gateway and
direct mode. SQLite needs a disposable database and two client contexts.
Production credentials, data and deployment are outside this qualification.

Baseline checks use the host's Bun and Vitest commands. Run
`bun run test -- shared/explorer app/db/__tests__/derived-indexes.integration.test.ts app/db/__tests__/project-workspace.integration.test.ts`
for persistence. Use the local Playwright profile, with SSR auth and sync
disabled, for Files interactions.

## Interaction fixture

Seed a Files root, an empty folder, a branch 20 folders deep, and 5,000 uniquely
named documents and uploads spread across 500 folders. Record the same seed,
browser/version, viewport, theme, and mode for each run. Use blank, retro, and
cyberpunk in light and dark at 320, 768, and 1440 pixels.

1. Click a document and verify that it opens. Ctrl/Cmd-click and Shift-click
   other rows and verify that they select without opening. Repeat with
   checkboxes and touch Select mode, including Done.
2. Shift-select between mounted and unmounted rows. Verify the result count and
   that Select all includes off-screen results. Scroll the focused row into
   view before DOM focus.
3. Drag an unselected row to the root breadcrumb and a selected group to the
   empty folder. Try dropping a folder on its own descendant and creating a
   duplicate sibling name. Verify no writes or activation on refusal or Escape.
4. Use Move to… to choose Files root, then create and select an explicitly
   named destination. Cancel the move and verify the new folder remains empty.
5. Move exactly 100 canonical rows, then attempt 101 and verify atomic refusal.
   Record actual counts and verify unchanged content and file hashes.

## Running the local checks

Run `bun run test:e2e:shared-file-explorer` to start the offline development
profile and record Chromium traces and screenshots. The browser journey
exercises Files in the actual storage fixture and Project Home through the
normal sidebar. Theme coverage includes Blank, Retro, and Cyberpunk at phone
width. The database suite exercises a complete metadata vector and asserts the reader
uses index keys without opening post values. The benchmark targets in task 7.6
also require a production browser build, folder/depth fixture, and a timing
receipt.


## Qualification results

Chromium verified nested Files navigation, modified selection, move targets,
drag to an empty folder and the root breadcrumb, original-text preview, bulk
Trash and restore, and destination creation independent of a canceled move.
It also verified touch selection, Type preference across reload, and Undo from
the notification. Project Home creation, project OS-drop refusal, and nested
shortcuts passed through the normal sidebar. Blank, Retro, and Cyberpunk
passed at 320 pixels in Chromium and WebKit. The WebKit runtime reproduces an
IndexedDB Blob failure with a native write, so WebKit upload is still open.

A production static build, served on loopback and opened in Chromium,
qualified the 5,000-document, 500-folder, 20-level fixture. Thirty measured
folder interactions had a 121.7 ms p95, with 18 mounted rows at peak. The browser
selected all 5,481 root rows. Instrumentation counted one metadata key cursor
and zero content-body requests. The optional navigator appeared in a wide Files
pane and collapsed at the narrower width while retaining the active folder.

On the Cloud worktree, screenshots, a 53-second walkthrough, and timing data
are under `test-results/explorer-delivery/`. The underlying Playwright runs
include `shared-file-explorer-finish`, `explorer-final-interactions`,
`explorer-project-final`, and `explorer-production-verified`. The source
checkout commands are `bun run test:e2e:shared-file-explorer` and
`PW_PORT=<served-static-port> bun run test:e2e:shared-file-explorer:production`.

## Disposable Cloud qualification

The host and both external development sources use the same Explorer v1
identity rules. The SQLite and Convex gateways advertised the capability in
authenticated sessions and refused old push, pull, and snapshot requests.
Both accepted opposite moves from two clients and preserved a late placement
beside the retained record of its removed parent. The checksummed backups
included the actual deleted record and the original file bytes verified against
their SHA-256 hash. Convex direct mode was also exercised through a deployed
template and a watch wakeup. The loopback Convex binary was
`precompiled-2026-11-16-80befbc`. The SQLite browser profile verified Cancel,
Continue, and the device preference on later writes. The separate SQLite browser
restore preserved the original SHA-256 and recovered the late placement to
its surviving ancestor.

The provider source baselines are recorded above. The test profiles used the
modified source builds of SQLite 0.0.31 and Convex 0.0.27. The provider candidate
commits are SQLite `81f3631343c022f23e5dd30cf9f81c842f20676f` and Convex
`56ed531b656879e58be3ef03962d14cd58204a01`. The bundled Convex template was rebuilt through the provider script. The exact npm dependency
pins are unchanged. Cloud folder writes require a provider that advertises
the deployed capability. D1 does not advertise it.

Repeat the gateway checks with
`bun scripts/test/qualify-file-explorer-gateway.ts <disposable-profile>`.
Repeat the direct checks with
`bun scripts/test/qualify-file-explorer-convex.ts <disposable-sandbox>`.
Cloud browser checks use `PW_PORT=<profile-port> bun run test:e2e:shared-file-explorer:cloud`.
Set `PW_EXPLORER_RESTORE_RECEIPT` to the gateway qualifier's
`explorer-receipt.json` to run the independent restore check. Keep this
fixture data separate from real accounts and workspaces.
