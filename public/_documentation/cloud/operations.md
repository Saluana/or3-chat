# Server restarts

**Admin → Operations** shows whether this server supports dashboard restarts. They require deployment super-admin access, `OR3_ADMIN_ALLOW_RESTART=true`, and a healthy lifecycle controller. Source development uses `bun run dev` or `bun run dev:ssr` on macOS/Linux; managed single-host installations use the installed operator. Arbitrary process managers, older operators, Windows launchers, static builds, and multiple application replicas are unsupported.

## What a restart does

Confirm **Restart Server** to wait for active work, briefly stop serving requests, replace the owned server process, and check a new healthy boot. Acceptance is not success: the dashboard reports success only after it verifies the new boot and effective settings. Leave a tab open or return to Operations to observe the same operation. Losing the acknowledgement or signing in again does not submit another restart.

Preparation waits up to five minutes. **Cancel waiting restart** is available before stop is authorized. Work that does not finish cancels the operation rather than being force-interrupted. Final request draining is bounded to 15 seconds; runtime cleanup allows 20 seconds and the development supervisor and managed containers allow 25 seconds. Existing passive job streams close and can reconnect.

There is no force button. Memory, SQLite and Convex jobs, including parked browser-tool handoffs and workflows, block replacement until they finish or are safely cancelled through their existing job controls. SQLite/Convex accounting also waits for pending admission and terminal history delivery. Use rebuilt provider artifacts containing shutdown accounting; Convex requires its matching generated backend. Versions without that contract report unsupported when background execution is enabled. Database errors or a missing Convex function cancel preparation safely. Custom execution owners must participate in the shutdown controller; detached work cannot assume automatic recovery or tool replay.

Pending canonical history continues retrying during preparation, so a temporary
delivery failure can recover without restarting model execution. New claims
stay paused. Cancelling the restart releases the wait even if a provider lookup
is stalled; a late lookup response cannot authorize that cancelled restart.

## Saving and applying settings

Registration policy and the restart permission are the initial verified settings. Registration saves use the controller's authoritative configuration file, with a revision check to prevent overwriting another save. **Apply saved settings and restart** names the saved revision being activated. The current policy remains in effect until a replacement reports the expected effective value.

Managed activation recreates only the application container using its existing image and data volume. An ordinary container restart keeps its existing environment. Source activation reloads the launch environment while preserving real exported overrides, runtime, arguments, port and provider artifacts. A conflicting external override or changed provider/path/port requires setup; it cannot produce a verified success.

Other dashboard fields are marked **Build** or **Deployment** and are read-only. Bundled themes and application changes need the supported source build or managed update workflow. The retired rebuild endpoint never builds over live serving output. For managed updates and recovery procedures, follow the repository's canonical `docs/cloud-updates.md` guide.

In source development, Vite may reload the current page when its WebSocket reconnects. Registration and the restart-permission editor retain their non-secret unsaved selections for that tab across this reload. A draft retains its original save revision; discard it to load newer saved values after a concurrent edit. Managed restarts do not request a full-page reload. Enabling restart for the first time still requires the launch configuration; a disabled runtime cannot authorize its own replacement.

Development restart checks prepared provider entry points and dependency/generated-provider inputs before acceptance and again before stop. Missing artifacts or changed dependency inputs require the normal source setup/build path. Replacement reuses valid caches and explicitly rebuilt provider artifacts.

The owned development child awaits Nuxt's close API before exit, with one signal owner and Nuxt warming forks disabled. Nitro owns final exit in the managed server. Development WebSocket handshakes that receive no response during startup close after five seconds so Vite can retry; established idle sockets stay connected.

Source processes launched with `CI` or `TEST` execution flags report restart unsupported: the installed Nitro version skips awaited dev-worker cleanup in those modes. The isolated browser harness clears those flags only for its owned development server; the test runner keeps its own CI behavior.

## When recovery needs attention

An interrupted controller keeps its receipt and blocks competing mutations. **Recheck existing restart** observes that receipt; it never repeats stop or recreation. A receipt with no stop intent can be cancelled safely. A receipt with stop intent resolves only when a new ready boot, configuration, image and data identity can be verified. Otherwise inspect the source terminal or deployment diagnostics before taking further action.

After nine minutes without a verified result, the browser reports that observation timed out and reduces polling. It retains the operation ID through reload and reauthentication, keeps another restart blocked, and can still observe the original operation completing.

A page authentication check interrupted by maintenance reports temporary unavailability rather than treating the outage as a logout. It does not render protected content from cached identity. A confirmed expired or rejected session still requires signing in again.

Restart controls authenticate the deployment super-admin cookie directly. Observing or cancelling a restart does not resolve or provision workspace state during shutdown.

Managed CLI recovery supports inspection with `recover --dry-run` and explicit observation with `recover --finish`. It does not restore data or retry an uncertain replacement. Use the compatible installed CLI and the canonical update guide; do not delete an unresolved journal to bypass its lock.

Local drafts and queued sync/storage work stay in the browser. Maintenance responses defer transfers without spending their failure budget; retry obtains a fresh upload URL. Reconnection never starts a new paid generation or repeats an uncertain tool effect automatically. These are brief-outage restarts, not a zero-downtime deployment system.

## Contributor qualification

Add `--background=sqlite` to `--failure --dev --https` to exercise durable SQLite
background execution. Convex qualification uses the provider's existing
`scripts/test/backend-lifecycle.mjs` runner with `drain dashboard` after its
cached-binary, host, baseline-pack, evidence-directory and candidate-provider
arguments. It starts an isolated loopback backend, deploys candidate templates,
and supplies disposable credentials to the same dashboard harness. It never
accepts a live deployment URL or uses a paid model.

Use the repository-pinned Bun version. The isolated harness is `bun run test:e2e:server-restarts --dev`, with `--managed`, `--failure`, and `--performance` selections. Performance can be combined with `--dev` or `--managed`. Managed fixtures require cached immutable app/operator IDs through `OR3_RESTART_TEST_IMAGE` and `OR3_RESTART_TEST_OPERATOR_IMAGE`; the harness never pulls or publishes an image. Build the exact lifecycle bundle with `bun run --cwd packages/or3-cloud build` before using managed fixtures.

Artifacts under `test-results/server-restarts/` record boot identities, readiness samples, image/volume checksums and fixture cleanup. On macOS, the disposable managed fixture places IPC on a Linux volume because Docker Desktop cannot change permissions on host-shared sockets; production dashboard operator support remains Linux-only. Performance qualification uses ten warm dev and twenty warm managed restarts, with 60-second and 10-second p95 outage targets respectively. Report measured results with the runner and image identities; these targets are not promises for every machine.
