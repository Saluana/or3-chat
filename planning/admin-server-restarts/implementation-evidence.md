# Implementation evidence

## Baseline and credible failures

Implementation branch: `codex/admin-server-restarts`, based on `6288a354252b90c2cdacb86b67411ad7c5bbdfea` plus the existing dashboard working changes and planning documents copied without changing the source checkout. The copied patch is retained separately during implementation.

| Boundary | Credible failure | Primary regression owner |
| --- | --- | --- |
| Shutdown | Hung provider count defeats deadline; active jobs ignored; response disconnect precedes persistence; query-string health blocked | Existing graceful-shutdown controller suite and real-process fixture |
| Controller | Duplicate/lost acknowledgement restarts twice; crash after stop intent reexecutes; corrupt/full journal loses replay | Durable controller process fixture |
| Development | Inherited file values stale; shell overrides clobbered; deleted keys survive; child workers/listeners orphaned | Standard launcher process fixture and real dashboard journey |
| Managed | Read-only app marker fails; container restart does not reload host env; mutation races update/restore; wrong image/volume | Disposable Compose fixture and existing CLI lifecycle/process suite |
| Configuration | Concurrent save loses changes; partial write; unseen revision applied; override falsely attested | Existing env-file/config suite and activation journey |
| UI | Initiation falsely succeeds; reload/lost response submits a second operation; tabs disagree | Existing restart composable suite and real two-tab browser journey |
| Work continuity | Background claim starts during drain; uncertain tool repeats; transient maintenance exhausts transfer retries | Existing execution/transfer suites and deterministic continuity E2E |
| Build | Live serving output deleted by shell rebuild | Legacy endpoint behavior regression |

Regression repairs were exercised in their canonical suites before changing production behavior. New process/E2E coverage uses actual child processes, browser gateways and a loopback scripted model. No fixture fakes successful restart, exit or controller acknowledgement. The browser continuity page constructs production queues over disposable IndexedDBs and talks to the real authenticated gateways; its injected faults are browser transport responses.

## Environment

- Audit shell Bun: 1.3.6; repository pin: 1.3.14. Qualification uses an isolated temporary copy of the pinned release.
- Local Docker engine: 29.2.0. Docker fixture operations require the tool's sandbox escalation because the local engine socket is outside the original workspace.
- The new managed worktree also lies outside the original writable root; authorized writes use the tool's reviewed escalation.

## Results

| Qualification | Result / evidence |
| --- | --- |
| Cross-cutting non-live gate | `bun run test:full`: 744 files, 7,024 passed, one existing skip; 167.84 seconds. `/tmp/or3-restart-full-tests.log`. Later local changes receive focused qualification below. |
| Managed package | Full `bun run check` passed: typecheck, both packaged bundles, 247 tests passed, four existing skips, zero failures (251 cases). `/tmp/or3-restart-package-final.log`. This includes the legacy operator/update JSON contracts and managed recovery/process lanes. |
| Local package contents | `bun pm pack --dry-run --ignore-scripts` includes `assets/dashboard-lifecycle.mjs`, operator, Compose assets and CLI. No package/image was published. |
| Dev functional | All three HTTPS execution/queue/dashboard journeys pass in `2026-10-17T21-23-12.694Z/`. After the narrow control-auth repair, the dashboard journey passes again in `2026-10-17T21-31-15.804Z/`: two ordinary restarts, lost acknowledgement, both admin drafts restored, saved policy activated, actual HMR frames and four completed cleanup records. |
| Managed functional | Final exact-image operator/read-only app pass two ordinary restarts plus same-image recreation for registration activation. Artifacts: `test-results/server-restarts/2026-10-17T21-32-34.346Z/`; image, volume, grace period and checksum retained, with three completed cleanup records. |
| Dev performance | Ten warm idle HTTPS restarts; 100 ms probes. Outage p50 **8,173 ms**, p95/max **8,995 ms**; maximum acceptance 45 ms and preparation 929 ms. Artifacts: `test-results/server-restarts/2026-10-17T21-11-58.746Z/`; subsequent auth repairs are qualified separately below. |
| Managed performance | Twenty warm idle restarts of the final image; 100 ms probes. Outage p50 **954 ms**, p95 **1,203 ms**, max **1,271 ms**; maximum acceptance **556 ms**, maximum preparation **991 ms**. Artifacts: `test-results/server-restarts/2026-10-17T21-33-31.126Z/`; exact final image/bundle identities are recorded below. |
| Build boundaries | Final SSR production build and plugin-runtime check passed (`/tmp/or3-restart-ssr-build-control-auth.log`). Final static generation and client/server isolation check passed (`/tmp/or3-restart-static-build-qualified.log`). |
| Documentation | `bun run check:docs`: 114 files, 102 routes, twenty typechecked examples passed. |
| Active execution | Real memory job + server tool: preparation blocks new generation; cancellation restores admission; later replacement waits for final history. One tool execution/two expected model requests and persisted completed history proved in `test-results/server-restarts/2026-10-17T20-05-14.241Z/active-job.json`. |
| Journal faults | Corruption regression rejected malformed JSON/foreign identity but initially accepted a mismatched outer request ID. The repair now verifies the payload fingerprint and inner/outer identity. Named failure lane passed 18 lifecycle/controller cases, including actual controller SIGKILL before/after execution intent and private-file/capacity checks. |
| HTTPS continuity | Actual HTTPS browser execution and queue journeys passed in `test-results/server-restarts/2026-10-17T20-13-48.101Z/`: one tool effect, completed durable history, original sync/transfer IDs, zero maintenance attempts, fresh presigns after a lost commit acknowledgement, one metadata reference and downloaded byte equality. |
| Error-response draining | The combined journey exposed a 403 sync request permanently counted as active. A real H3 handled-error regression reproduced it before repair. Tracking now wraps actual handler completion in `finally`, including errors, instead of relying on `afterResponse` (which an already-handled error can skip). The nine-case canonical shutdown suite passed after repair. |
| Confirmation race | A canonical composable regression reproduced polling changing the revision while confirmation was open. Submission now freezes the revision presented before confirmation; all thirteen composable/shutdown cases passed together after repair. |
| Additional failure boundaries | The named failure selection passed 24 controller/shutdown cases, including an actual replacement child exiting 42 while its controller stays available, old-boot verification expiry, wrong effective settings, and disappeared prepared artifacts/dependency drift. Failed-startup qualification is at the real controller/child-process boundary; successful app journeys use the actual Nuxt launcher. |

Runner: macOS source worktree, Bun 1.3.14, native Nuxt runtime selected by the existing launcher, Docker Desktop engine 29.2.0 and cached Node 24 app/operator images. Managed qualification on macOS uses a disposable Linux IPC volume because Docker Desktop returns `EINVAL` when chmod-ing host-shared Unix sockets. Production Linux bind-mount permissions are unchanged; this fixture does not claim macOS managed-operator support. Every successful journey reports closed owned ports and removed disposable data/containers.

The isolated Nuxt cache uses `OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true`; otherwise a worktree sharing `node_modules` can share another checkout's default cache. The first non-isolated build failure was this environmental cache collision, not a successful build. Vite reloads a dev page when its WebSocket reconnects; Registration and the unmasked restart-permission field persist non-secret unsaved selections per tab across that reload. Explicit browser reload assertions reproduced the latter loss before its repair.

## Final qualification

After the owned-close/HMR repairs, the complete `--failure --dev --https` selection passed **25 controller/shutdown cases and all three browser journeys**. Artifacts: `test-results/server-restarts/2026-10-17T21-01-04.529Z/`; `/tmp/or3-restart-continuity-e2e.log`. They include actual Vite reconnect frames across two consecutive restarts, saved-policy activation, real execution/queue continuity, retained identity after logout/reload/login with exactly one submission, and six completed asynchronous runtime cleanup records. All owned ports closed and disposable data was removed. Subsequent focused changes and final adapter runs follow below.

Failure presentation screenshots deliberately render actual failed-startup/configuration-mismatch receipts from the controller fault lane. They are a UI presentation check, not a claim that a full Nuxt failure was injected. Observation-expiry presentation retains the operation ID, disables another restart and submits no mutation (`failure-presentation.json`). The actual process fault and actual successful restart remain separate assertions.

Root type checking passed (`/tmp/or3-restart-typecheck-final.log`), as did 74 launcher/composable cases (`/tmp/or3-restart-launcher-final.log`), changed-file lint and 114-file documentation checks. The runtime-selection fixture now executes the real owned-child entry and substitutes only its external CLI dependency. The final managed CLI/lifecycle bundles and package typecheck passed. Following the final control-auth repair, root type checking, changed-file lint and documentation checks passed again (`/tmp/or3-restart-{typecheck,lint,docs}-qualified.log`). Static generation and its plugin-runtime/client isolation check also passed on this source (`/tmp/or3-restart-static-build-qualified.log`). Final SSR and exact-image adapter results are recorded below.

The first post-cleanup ten-run sample included three live dev tabs and late Vite page reloads. It passed the 60-second dev target (p50 11,795 ms, p95/max 37,465 ms) but is not described as an idle reference sample. It exposed an admitted SSR render whose session callback was rejected during final drain. Session resolution can provision persistent state, so it remains counted and subject to final admission rules. A canonical auth-middleware regression reproduced maintenance being misreported as logout (`/tmp/or3-restart-auth-maintenance-before.log`). Auth page checks now use a three-second timeout without automatic retries, preserve identity on temporary failure and return 503 without rendering protected content; actual 401/403 clears cached identity and redirects. All 28 auth/shutdown/composable cases passed after repair (`/tmp/or3-restart-auth-maintenance-fixed.log`).

The clean idle performance selection closes its already-warmed UI tabs and measures authenticated restart API requests without page-render work; multi-tab/HMR correctness remains qualified separately. Ten HTTPS dev restarts passed with p50 **8,173 ms**, p95/max **8,995 ms**, maximum acceptance **45 ms**, and maximum preparation **929 ms**. Artifacts: `test-results/server-restarts/2026-10-17T21-11-58.746Z/`. Eleven asynchronous cleanup records include final fixture shutdown; owned ports closed and temporary data was removed. The final auth middleware repair follows this idle sample and is qualified separately below.

The corrected final SSR build passed (`/tmp/or3-restart-ssr-build-qualified.log`). Its offline local image is `sha256:f0f0eca5c197bdda99900164668221ea59f78d39f6bcf495205971dd3f1a8df6`. The exact-image managed functional run passed (`test-results/server-restarts/2026-10-17T21-21-12.845Z/`): three replaced boots completed asynchronous file cleanup, the image and volume/checksum stayed identical, the app remained read-only with 25-second grace, and fixture containers/data/ports were cleaned up.

The first final dev rerun (`2026-10-17T21-20-29.074Z/`) passed all 27 process/shutdown cases and two browser journeys but failed the queue fixture's initial five-second mount assertion while the image build ran concurrently. This is a recorded failure, not a full-suite pass. Its restart/HMR and settings journey completed, and all owned ports closed. The fixture's cold Vite dependency compilation now uses the same bounded 30-second mount allowance as its post-replacement mount; no production restart or outage deadline changed. The isolated rerun is recorded below.

The isolated `--failure --dev --https` rerun passed **27 process/shutdown cases and all three browser journeys** (`2026-10-17T21-23-12.694Z/`, `/tmp/or3-restart-dev-qualified-repeat.log`). Six replaced workers completed asynchronous cleanup. Queue identity/bytes, one tool receipt, settings/drafts, repeated HMR and failure presentation all passed; owned ports closed and temporary data was removed.

Final control-auth review found that the generic admin resolver also attempted workspace-session resolution, which may provision persistent data. Restart controls now authenticate only the verified deployment cookie using an explicit resolver option, preserving host, mutation and authorization checks. Other admin routes retain their existing behavior. The canonical real-HTTP security case failed before the repair (`/tmp/or3-restart-control-auth-before.log`) and verifies both valid-cookie observation and cookie-less 401 without calling workspace resolution after repair. All **56 auth, admin-gate, registration, shutdown and composable cases** passed (`/tmp/or3-restart-control-auth-fixed.log`). This narrow repair follows the preceding full journey; final build/adapter verification is recorded below.

The final source passed both build modes, then the actual HTTPS dev dashboard journey (`2026-10-17T21-31-15.804Z/`) and actual managed dashboard journey (`2026-10-17T21-32-34.346Z/`). Both retain exact boot/cleanup evidence and report closed ports and removed temporary data. Final app image: `sha256:99b0a0d16fcfeb3934d464cd9d5f15b28769c6503cee07a6fc191cd473e43f3d`; operator image: `sha256:c3d879d2e38e8318bda88adff9378cb1f89d9f9c3c825be22eb2ddc5d7c4cc56`; installed lifecycle bundle SHA-256: `128fc1bab43ffcf2d36dfa76060ef3a03a0e5ccec4ff57f31ddb4c64f74eec9d`.

The final exact-image managed idle benchmark passed all **twenty** restarts (`2026-10-17T21-33-31.126Z/`, `/tmp/or3-restart-managed-performance-qualified.log`): p50 **954 ms**, p95 **1,203 ms**, maximum **1,271 ms**, maximum acceptance **556 ms**, maximum preparation **991 ms**. All twenty replaced boots completed the real asynchronous cleanup exactly once. The image, volume and proof checksum stayed identical; the app stayed read-only with 25-second grace. Fixture cleanup reports closed ports and removed data, and a final container inventory found no remaining restart fixtures. The ten-dev/twenty-managed warm idle targets pass without reducing safety deadlines or bypassing the production rate limit.

The initial implementation tasks were checked off after their final adapter/build checks. The durable-provider follow-up below records subsequent changes and qualification separately. Remaining capability boundaries are explicit unsupported/conditional cases, not unverified success paths.

Installed Nitro explicitly skips awaited dev-worker cleanup when `CI`/`TEST` execution hints are active. A controller-registration regression failed before adding a fail-closed source-mode gate; both flags now refuse adapter availability. Managed mode is unaffected. The browser fixture clears these flags only for its owned normal-development server, while the runner retains CI policy. This is a supported-mode boundary, not an assumption that a successful new boot proves cleanup.

The combined HTTPS run exposed an early WebSocket upgrade that received no response while Vite was starting. Vite's installed reconnect ping has no handshake timeout, so it could wait indefinitely despite application readiness. A real TLS/upgrade regression failed before the repair (`/tmp/or3-restart-hmr-regression.log`). The development listener now closes an unanswered handshake after five seconds, allowing Vite's existing reconnect loop to retry; established idle sockets are unaffected. The same regression passed after repair (`/tmp/or3-restart-hmr-regression-fixed.log`). The browser qualifies actual Vite `connected` frames, rather than treating HTTP readiness as HMR recovery.

The disposable runtime-close fixture opens a real private file handle in the application worker. Its asynchronous Nitro `close` hook writes, fsyncs and closes that resource. The named harness checks exactly one completed cleanup record for every replaced boot. It is included only by the existing production-journey harness plus the explicit restart qualification flag; normal static/SSR builds do not include the fixture. The initial real dev process run produced no cleanup records: the installed Listhen signal path exits immediately. The owned dev child now awaits the public Nuxt CLI close handle and removes competing CLI signal exits, including those registered at listen time; Nuxt warming forks are disabled. The supervisor still owns the process group and outer deadline. Managed final exit remains Nitro-owned.

A long-outage observation regression also reproduced loss of the browser's operation ID at expiry. Expiry now preserves identity and blocks a second restart, reduces polling to the idle interval, distinguishes reauthentication, and can still observe verified completion. The five-case composable suite passed after repair (`/tmp/or3-restart-observation-fixed.log`).

## Acceptance traceability

Paths below are relative to the repository root. The Results table and final qualification record identify commands and retained artifacts; controller fault tests are distinguished from full application/browser journeys.

| Criteria | Implementation | Qualification owner / result |
| --- | --- | --- |
| R1.AC1–AC4 | `shared/admin/restarts.ts`; `server/admin/system/server-control.ts`; guarded `server/api/admin/system/restart*.ts`; SSR-only adapter plugin | Capability/guard regressions, actual dev/managed dashboard journeys, static isolation build. Missing/legacy controllers and unqualified execution accounting report unsupported. |
| R2.AC1–AC4 | `shared/server/restarts/controller.ts`; private atomic journal; managed deployment lease | Named process faults: durable replay, conflicting ID, racing requests, bounded capacity, corruption and actual controller SIGKILL. Browser lost-ACK journey requires acceptance <=2 seconds and observes the original ID. Managed CLI suite refuses unresolved dashboard work. |
| R3.AC1–AC5 | `server/utils/shutdown/{controller,runtime}.ts`; `server/plugins/graceful-shutdown.ts`; `shared/dev/nuxt-child.mjs`; dev/managed termination budgets | Canonical shutdown suite covers hanging lookups, actual handled H3 errors, late persistence and cancellation. Real app journeys verify admission, committed history/bytes and new boots; runtime-close artifact qualifies installed Nitro cleanup. Nitro owns managed exit; the owned development child awaits Nuxt close before exit. Application/runtime/supervisor-or-container budgets are 15/20/25 seconds. |
| R4.AC1–AC2, AC4–AC5 | Background scheduler, provider blocker accounting and actual tool-handler promise tracking | Real memory job/tool journey waits, cancels and resumes admission, then completes history before replacement with one tool receipt and exactly two expected local model requests. Existing execution/fencing regressions remain green. Unqualified providers fail closed. |
| R4.AC3 | Wait-only public schema; no recoverable-interruption capability | Conditional requirement is unavailable: neither generic force nor claimed checkpoint handoff is advertised. Provider accounting/handoff must be qualified before adding that action. |
| R4.AC6 | SQLite covering-index counts; Convex transactional bounded query; shared wait-only controller | Durable-provider follow-up below: real SQLite and Convex lifecycle/backend tests plus actual HTTPS dashboard matrices pass. Missing functions and offline lookups fail closed. |
| R5.AC1–AC5 | `packages/or3-cloud/src/dashboard-lifecycle.ts`; canonical lifecycle/Compose runner, lease and recovery gates | Disposable operator/read-only app fixture checks exact image/volume/grace and persistent checksum across restart/recreate. Process startup/crash faults retain evidence and never automatically restore data or repeat replacement. Legacy protocol/package suite passes. |
| R6.AC1–AC6 | `shared/admin/configuration.ts`; `shared/server/restarts/configuration.ts`; parameterized env writer; Registration and Advanced UI | Optimistic revision/atomic writer and override/deletion tests; confirmation-race regression; real saved-policy activation in dev/managed journeys. Advanced and Registration drafts survive explicit reload. Unsupported/provider/credential/build fields remain outside the apply allowlist. |
| R7.AC1–AC3 | `scripts/cli/dev.ts`; `shared/dev/{environment,restart-supervisor,readiness}.ts` | Actual standard launcher journey; explicit-loader tests cover changed/deleted values and equal-valued genuine shell override. Prepared-artifact/dependency drift refuses replacement; warm restart reuses caches/artifacts. |
| R7.AC4–AC6 | Supervisor-owned watcher, child group, bounded handshake and journal | Repeated same-origin HTTPS dashboard journeys check distinct boots and actual HMR frames. Watcher targets are serialized/coalesced by revision; cleanup artifacts check owned ports and data removal. Failed replacement child leaves its controller alive without respawn. |
| R8.AC1–AC5 | `app/composables/admin/useServerRestart.ts`; shared Operations/Registration/Themes surfaces | Composable verified-identity/lost-ACK/confirmation regressions plus real multi-tab UI journey. Active-job browser logs out/reloads/signs back in, retaining the request ID and exactly one restart submission. Controller startup/config mismatch faults remain distinguishable from successful browser recovery. |
| R9.AC1–AC4 | Existing production sync outbox/gateway and workspace-scoped DBs; storage maintenance deferral | Real authenticated browser queue journey injects maintenance and a lost successful commit ACK around actual replacement/workspace switch. Original IDs/bytes and zero maintenance failure attempts survive; fresh presigns, one metadata reference and downloaded byte equality are asserted. Genuine 403 remains an authorization failure. |
| R10.AC1–AC3 | Non-executing legacy rebuild endpoint; strict private schemas; same-image lifecycle runner | Rebuild/registration boundary regressions and managed package suite; fixture performs no pull/build/restore. Restart does not rewrite `.output`; Themes directs to supported build/update documentation. |
| R11.AC1–AC4 | Bounded structured phase/workload records; durable replay capacity; monotonic deadlines | Ten dev and twenty managed warm samples with separate preparation and 100 ms outage probes, recorded above. Journal-full and deadline/process faults refuse or report typed attention states without another replacement. Logs contain identities/counts/codes, not settings, credentials or prompts. |
| R12.AC1–AC5 | Canonical regressions, named isolated harness, packaging and public docs/docmap | Failure matrix and regression-before-repair logs above; root cross-cutting gate, package suite, build isolation and docs checks. Browser JSON/screenshots retain redacted evidence; credential-bearing traces are disabled deliberately. The durable-provider follow-up also rebuilds both providers and the matching Convex backend contract. |

## Supported scope and limitations

- Source launchers on POSIX in normal development execution mode and the managed single-host Basic Auth/SQLite/filesystem profile are the qualified targets. Source `CI`/`TEST` mode, arbitrary process managers, Windows, older operators and multi-instance orchestration fail closed or remain unsupported.
- Background providers must expose reliable blocker accounting. The SQLite/Convex source follow-up below adds that contract; older published outputs without it still refuse dashboard restart. Convex requires its matching generated backend. Memory jobs are qualified for waiting to completion, not interruption or survival after an external kill.
- Failed-startup/controller-interruption tests use actual disposable controller/replacement processes. They do not claim to exhaust every Nuxt boot failure or cloud-provider failure. Real success/continuity journeys use the actual Nuxt application and gateways.
- Reported warm latency is specific to the recorded runner and cached image. Active work can make preparation substantially longer; cancellation preserves work instead of forcing a fast exit. No zero-downtime claim is made.
- These changes create no release, publication or live deployment. `docs/cloud-updates.md` remains authoritative for updating an installed application.

## Review and reproduction

Implementation is retained as working changes in the attached worktree `/Users/brendon/.codex/worktrees/admin-server-restarts/or3-chat`, branch `codex/admin-server-restarts`. The original `or3-cloud` checkout advanced independently to `066182b0` during this work; its changes were not reset or overwritten, and its existing development process on port 3000 remains running. Integrate this worktree against the current branch during review rather than replacing that checkout with the audit snapshot.

Use repository-pinned Bun 1.3.14. The named isolated development matrix is `bun run test:e2e:server-restarts --failure --dev --https`; the idle sample is `bun run test:e2e:server-restarts --performance --dev --https`. Managed selections use `--managed` or `--performance --managed`, with `OR3_RESTART_TEST_IMAGE` and `OR3_RESTART_TEST_OPERATOR_IMAGE` set to the final cached IDs recorded above. They create disposable fixtures and do not pull or publish images. Local packaging remains `bun run --cwd packages/or3-cloud check`; static and SSR qualification use `bun run generate:static` and `bun run build` with the isolated fixture configuration. Do not rebuild over an actively serving output directory.

## Durable-provider drain follow-up (2026-10-17)

Source is isolated in sibling `or3-provider-sqlite` and `or3-provider-convex`
worktrees under `/Users/brendon/.codex/worktrees/admin-server-restarts/`, each on
`codex/admin-server-restarts`. Original provider checkouts and their dirty work
were left intact. The host has a private dependency view pointing at rebuilt
provider outputs; it does not overwrite the original installed packages.
No package version, publication, or live deployment was changed. Convex must
ship its matching backend digest with its provider; immutable-version checks
remain enforced.

SQLite counts all streaming jobs plus disjoint terminal pending-admission/history
rows using covering indexes (additive migration 025). Convex checks existence
in each status/admission/finalization index in one transaction, reading at most
one document per bucket and returning one on the first blocker. Its lower-bound count cannot return zero while
work remains. Neither implementation falls back to zero on lookup errors.
Parked browser tools, workflows and expired/unowned streaming jobs remain
blockers. The wait-only policy and lease renewal rules are unchanged.

Regressions were written first: SQLite failed on its absent drain method
(`/tmp/or3-drain-sqlite-red.log`); the real disposable Convex backend lane failed
on the same missing contract (`/tmp/or3-drain-convex-red.log`). A companion memory
race also failed before repair: cancellation made admission-pending work appear
idle (`/tmp/or3-drain-memory-red.log`). Memory now uses the same pending-phase
rule. The first full Convex dashboard run exposed the pre-existing Nitro ES2019
transform rejecting top-level backend verification; the server target is now
ES2022. A later run exposed a reset pooled socket during replay of an already
committed receipt; that assertion allows one transport-only retry with the same
operation ID. Neither repair weakens backend verification or restart identity.

| Proof | Result / artifact |
| --- | --- |
| SQLite provider | 234 passed, 11 existing skipped; final affected file 29 passed. Migration integrity, full host types, standalone types, lint and provider build passed. `/tmp/or3-drain-sqlite-{tests,final-focused,host-types,types,lint,build}.log` |
| Convex provider | 271 passed after preparing its required local generated host mirror; full host types, standalone types and provider/template build passed. `/tmp/or3-drain-convex-{tests-final,host-types,types,build}.log` |
| Host focused safety | 45 passed, including memory admission cancellation and shutdown; each real dashboard matrix also passed 27 process/shutdown cases. `/tmp/or3-drain-host-tests.log` |
| SQLite HTTPS dashboard | All 3 browser journeys passed. `test-results/server-restarts/2026-10-17T21-51-06.671Z/`; `/tmp/or3-drain-sqlite-dashboard.log` |
| Convex HTTPS dashboard | All 3 browser journeys passed. `test-results/server-restarts/2026-10-17T22-02-11.354Z/`; `/tmp/or3-drain-convex-dashboard-final/dashboard.log` |
| Real Convex backend | Legacy missing-function refusal, durable state after backend restart, pending admission and all terminal statuses, parked/workflow records, bounded-page safety, dashboard lifecycle and unavailable-backend cancellation passed. `/tmp/or3-drain-convex-dashboard-final/drain.json` |
| Documentation | 114 files, 102 routes, 20 examples passed. `/tmp/or3-drain-docs.log` |

Both dashboard artifacts prove one tool execution, exactly two local fixture
model requests, preserved canonical history, retained receipt identity through
reauthentication, byte/checksum-preserving queues, and completed async close
hooks. Both report closed owned ports and removed temporary application data;
the local Convex backend is stopped and its temporary credential file removed.
The Convex job-store journey deliberately retains SQLite canonical workspaces
to isolate background storage. An existing detached notification hook logs a
Convex workspace-ID validation warning in this mixed-store fixture; notification
delivery is not qualified by this restart lane. Multi-instance orchestration and
forced interruption remain unsupported.

Reproduce SQLite with `bun run test:e2e:server-restarts --failure --dev --https
--background=sqlite`. For Convex, run the provider existing
`scripts/test/backend-lifecycle.mjs` with cached local backend binary, host root,
a baseline template pack without the drain query, evidence directory, candidate
provider root, then `drain dashboard`. The lane supplies only a disposable
loopback backend and local deterministic model. Keep installed provider artifacts
fixed during the run (`OR3_LOCAL_PROVIDERS=false` after building them).

Final host typecheck passed with the explicit disposable Basic Auth/SQLite/FS
profile (`/tmp/or3-drain-host-types-final.log`). An initial invocation inherited
unconfigured default Clerk/Convex selections and failed configuration validation;
it performed no build or deployment and was replaced by that explicit profile.
Final static generation and plugin-runtime/client isolation checks passed
(`/tmp/or3-drain-static-build.log`). Source provenance: SQLite base
`c21bef28f79b791c4fe06fd76130a6f365f59ccc`, Convex base
`e88d180611709c675ffb6225a6645dfd21e6b380`; initial follow-up backend digest
`a7becee691a5bccf7bd30b9a44381eff778464cb056092f2cf644e12294d78d2`.
The legacy-function fixture used the original pre-follow-up template pack, SHA-256
`37634aa390ab508a7cc39749d17e31d0543bf17622f9f0d7e505046d12a0eb2b`,
including that checkout existing unrelated changes; this is a missing-function
compatibility proof, not qualification of a published upgrade or live rollout.

Final production SSR build with Convex background execution selected passed,
including plugin-runtime/client isolation (`/tmp/or3-drain-ssr-build.log`). It used
synthetic non-live configuration; no deployment or backend update ran during
build. Final host changed-file lint and provider/host diff checks passed. The
Convex backend receipt is retained alongside browser artifacts as
`test-results/server-restarts/2026-10-17T22-02-11.354Z/convex-drain.json`.
Both complete dashboard matrices contain six unique completed runtime-close
records. All durable-provider follow-up checklist items are complete.

## Final review (2026-10-17)

Reviewed controller transitions and durable receipts, authenticated control
routes, owned development process replacement, managed identity/lease checks,
dashboard observation, request/work accounting and both durable providers.
Four concrete restart/recovery issues were reproduced before repair:

1. A cancelled preparation kept awaiting a stalled provider lookup. The existing
   shutdown suite failed on its 100 ms cancellation bound
   (`/tmp/or3-restart-final-review-cancel-red.log`). Preparation now has an abort
   signal that releases the accounting wait; a late result cannot advance it.
2. Convex loaded full pages of pending snapshots. Twenty-four real 800,000-byte
   terminal snapshots exceeded the 16 MiB transaction read limit
   (`/tmp/or3-restart-final-review-convex-red.log`). Indexed existence checks now
   return a valid lower bound of zero or one. Independent parked/workflow,
   admission and terminal-status scenarios protect every blocker category.
   The first repaired candidate backend digest was
   `73b887452e57e76105af95df2d73d4f0a20f4a0eefa0cedc272af7718b5b42c8`.
3. Preparation paused canonical-history retries while pending delivery itself
   blocked shutdown. A real SQLite dashboard run injected one transient failure
   at the canonical adapter boundary, then failed waiting for recovery
   (`/tmp/or3-restart-final-review-history-red.log`; artifact
   `2026-10-17T22-42-33.021Z/`). Tracked history delivery now continues while
   preparation blocks new claims and cleanup. Final drain still stops scans.
4. The first complete Convex dashboard matrix passed, but its retained large
   snapshots exposed the same byte-limit failure in cleanup. Extending the real
   backend case also reproduced it in pending-history reads
   (`/tmp/or3-restart-final-review-convex-maintenance-red.log`). Both scans now
   use the native `getConvexSize` helper with a 2 MiB per-bucket budget and the
   existing row caps. The regression consumes every pending snapshot across
   successive batches, checks maintenance before/after delivery, and verifies
   retained response bytes. The provider dependency floor is raised to 1.31.7;
   its lock already resolves that SDK, so no installed package was upgraded.
   The host already pins 1.46.0. See the official
   [size-helper changelog](https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md)
   and [transaction/document limits](https://docs.convex.dev/production/state/limits).
   The final rebuilt backend digest is
   `b8b29643f90934b02fb85e8e2ea1b100aa1d736b4d38bb9db99547e7d88c53a0`.

The first repaired SQLite matrix proved history recovery and restart, then its
queue fixture read an empty initial JSON value during a second HMR remount
(`/tmp/or3-restart-final-review-sqlite-e2e.log`). The fixture now publishes the
state element only after it has mounted and read IndexedDB. Assertions for
identity, bytes, queue attempts and canonical metadata remain intact. The final
SQLite matrix passed all 28 process/shutdown cases and all three browser
journeys (`/tmp/or3-restart-final-review-sqlite-final.log`, artifact
`2026-10-17T22-47-57.718Z/`), including the failed/recovered history receipt in
`history-recovery.jsonl`, one tool effect and two model calls. Owned ports closed
and temporary application data was removed.

The first large-snapshot green attempt hit the disposable backend's 4 MiB/s
write quota during fixture setup. Large fixture writes are now paced; no
production retry or safety limit changed. An explicit lint attempt including
normally ignored harness files exceeded the parser's default heap. The normal
production lint scope passed with an 8 GiB parser heap.

The first qualification of the final byte-bounded candidate passed the real
backend cases and the first two browser journeys, then timed out after five
seconds with only the Operations SSR shell visible
(`/tmp/or3-restart-final-review-convex-qualified/dashboard.log`; artifact
`2026-10-17T23-00-42.704Z/`). The harness navigated and immediately reloaded
before client startup completed; the log also recorded an interrupted dynamic
module fetch. It now performs one navigation and waits for the actual client
Operations card with the existing 30-second post-replacement mount budget,
then checks the same failure controls. Two existing unit query fixtures also
needed the real SDK's async-iteration interface; all assertions remain intact.

Final Convex qualification passed all six disposable backend scenarios,
28 process/shutdown cases and all three browser journeys
(`/tmp/or3-restart-final-review-convex-final-qualified.log` and its
`dashboard.log`; artifact `2026-10-17T23-06-38.566Z/`). The artifact includes
`convex-drain.json`, history failure/recovery receipts, original queue identities
and bytes, one tool execution, verified new boots/HMR, saved-policy activation,
and failure/expired-observation presentation with zero new submissions. Owned
ports closed and temporary application data was removed. The retained large
snapshots no longer produce recovery-scan read-limit errors.

Final checks passed: 47 focused host safety/recovery tests, all 271 Convex
provider tests, full host typecheck, host-backed and standalone Convex types,
frozen provider lockfile validation, rebuilt provider/template contract,
production lint, documentation checks and all three worktree diff checks.
Logs use `/tmp/or3-restart-final-review-*`; final unit and type receipts are
`convex-unit-final.log`, `convex-types-final.log` and
`convex-standalone-final.log` with that prefix. The concluding diff review
covered controller cancellation/admission, tracked history recovery, provider
query/migration behavior, authenticated controls, owned process replacement,
managed leases and browser observation. No remaining restart-blocking finding
was identified. Existing scope limitations above still apply; no package,
image or live backend was published or changed.

## Merge integration qualification (2026-10-17)

Local landing integrates the host destination `or3-cloud` at `8d774864`, SQLite
`main` at `ffbda7b`, and Convex `main` at `e55bd3e` with the reviewed restart
snapshots `d4156412`, `8460107`, and `b230b14`, respectively. The newer signup
invitation lookup/short-code work, storage maintenance UI and contributor
guidance are preserved. Conflict resolution keeps the verified restart controls
and revision contract alongside those changes. The combined Convex templates
were rebuilt with digest
`cae88023eee24930e4b30111d78a88630b977f73dd23bea033a87799fd103cd8`;
earlier digests above describe their historical qualification inputs.

Post-integration checks passed: 199 focused host tests, 235 SQLite tests with
11 existing skips, 272 Convex tests, both provider builds, host-backed and
standalone provider type checks, full host type checking, and the managed
package's complete check (247 passed, four existing skips, zero failures,
including type checking and both bundles). Receipts use
`/tmp/or3-restart-merge-{host-tests,sqlite-tests,convex-tests,host-types,cloud-check}.log`
and the corresponding provider build/type logs.

The first integrated browser run completed active-job/queue recovery and
repeated restarts, then its direct status GET encountered `ECONNRESET` on a
connection pooled from the previous boot (`/tmp/or3-restart-merge-convex-backend/`,
artifact `2026-10-18T00-48-29.568Z/`). That read-only helper now allows one
transport retry. The next run passed dashboard/HMR recovery but its client-only
queue fixture remained blank after an automatic Vite reload
(`/tmp/or3-restart-merge-convex-qualified/`, artifact
`2026-10-18T00-53-01.490Z/`). The persistence journey now reopens that fixture
after verified server recovery before asserting the original queue identities,
attempts, canonical metadata and bytes. The separate dashboard journey still
owns automatic HMR/recovery checks; production deadlines and assertions are
unchanged.

The final combined-source run passed all six disposable backend scenarios,
28 process/shutdown cases and all three browser journeys
(`/tmp/or3-restart-merge-convex-final.log` and its `dashboard.log`). Artifact
`test-results/server-restarts/2026-10-18T00-56-49.726Z/` retains
`convex-drain.json`, canonical-history failure/recovery receipts, queue/byte
proof, verified replacement boots/HMR, saved-policy activation and actual
asynchronous cleanup. Owned ports closed and temporary application data was
removed. These runs used a disposable loopback backend; no live backend,
package or image was published or changed.

Final documentation validation passed (114 files, 102 mapped routes, 20
typechecked examples). Targeted production lint exited successfully with two
pre-existing optional-chain warnings in registration's invitation-secret check;
the repository ESLint policy excludes Vue files. All three worktree diff checks
passed. Receipts: `/tmp/or3-restart-merge-{docs,lint}.log`.
