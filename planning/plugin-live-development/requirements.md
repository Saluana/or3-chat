# Requirements

## Introduction

Make standalone, installable plugin development a save-and-see workflow in real OR3 Chat. Starting development should prepare the local environment, open the plugin, and automatically build, admit, check, and reload edits. Keep the existing package runtime and publication contract; remove the repetitive work from the developer's daily loop.

## Context

OR3 Chat is a Bun/Nuxt/Vue application with Vitest and Playwright coverage. `scripts/cli/dev-plugin.ts` already launches an isolated loopback SSR instance with Basic Auth, SQLite, filesystem storage, and the V2 loader. The SDK already scaffolds portable packages and creates immutable candidates; the host already admits them, checks grants and state, runs a real browser canary, promotes them, and reconciles portable workers on `WORKSPACE_PLUGIN_RECONCILE_EVENT`. Missing pieces are startup convenience, source watching, automatic orchestration, and visible feedback. Admission currently allows only 30 requests/hour; SDK scaffolds lack a `dev` script; neither SDK publication nor a standalone development-host distribution is implemented. Source reference: branch `or3-marketplace`, commit `5517cc36`, plus the current working tree. Other in-progress changes, including plugin documentation and authority handling, must be preserved.

## Assumptions

- First delivery supports the existing `portable-v1` starter / `or3-portable-client-v1` profile: Manifest V2, isolated client worker. This is already the candidate path's supported scope.
- Bun and an OR3 source checkout with installed dependencies remain prerequisites. Automatically distributing a host is a separate release concern; this plan does not promise an npm-only bootstrap that the repository cannot currently supply.
- The primary command after setup is `bun run dev` in the plugin directory. A thin SDK command delegates to the existing host launcher; there is one watcher and one package pipeline.
- A new developer starts from the host checkout with `bun run dev:plugin --create ../my-plugin`. The command derives a local ID from the directory name, prints it, and supports `--id` for a chosen marketplace namespace. Existing projects use `or3-plugin dev . --host /absolute/path/to/or3-chat` once; the local host association is remembered.
- The developer signs in to the dedicated local instance and approves initial permissions once. A guided page handles existing app and administrator authentication and workspace selection; no pasted tokens, hand-edited environment files, or remote services are required.
- Reload means replacing the plugin worker and its registered surfaces. Saved settings/storage and host navigation survive; arbitrary plugin in-memory state need not survive.
- This request produces planning documents only. Public documentation changes and implementation are tasks below, not claims that the feature exists today.

## Out of Scope

- State-preserving module HMR, a Vite server inside the plugin, or a second runtime/preview emulator.
- Remote development hosts, tunnels, Docker provisioning, automatic host downloads, SDK publication, or marketplace automation.
- Trusted-host/server plugins, legacy V1 packages, multiple watched plugins in one process, and changes to the source-level Nuxt plugin route.
- Automatic permission expansion, state migration/reset, recovery of data written by faulty plugin code, or collection of analytics.
- A new plugin configuration language, arbitrary lifecycle hooks, or a general-purpose development protocol.

## Requirements

### R1: One everyday command

**User Story:** As a plugin author, I want to start with one command, so that I can work on my plugin instead of managing a host.

**Acceptance Criteria:**
- R1.AC1: WHEN `bun run dev:plugin --create ../my-plugin` runs from a prepared host checkout THEN it SHALL create a portable starter, install its SDK dependency, add a `dev` script, remember the local host, and launch development without asking for SDK paths or environment values.
- R1.AC2: WHEN `bun run dev` runs in that starter THEN it SHALL start the same development profile and open Chat with the plugin tab selected; `or3-plugin dev [root] --host <checkout>` SHALL associate an existing portable package with a host for subsequent runs.
- R1.AC3: IF the target directory is nonempty, the host is missing/incompatible, the package is unsupported, or dependency installation fails THEN startup SHALL explain the failing step and a concrete recovery action without overwriting source or continuing with a partially prepared package.
- R1.AC4: WHEN existing manual `bun run dev:plugin` or SDK candidate commands run THEN their documented behavior SHALL remain available.

### R2: Prepared and isolated local environment

**User Story:** As a new author, I want a working local host without service configuration, so that I can see my first plugin immediately.

**Acceptance Criteria:**
- R2.AC1: WHEN a linked project starts THEN its stable, project-specific profile SHALL own extension storage, sync and auth databases, filesystem blobs, administrator credentials/JWT state, and development artifacts; it SHALL not read or write another instance's application data.
- R2.AC2: WHEN a fresh profile starts THEN the launcher SHALL configure the local providers, required feature flags, local credentials, and secrets automatically; one guided sign-in form SHALL establish the existing application and administrator sessions and resolve the workspace without a typed workspace ID.
- R2.AC3: IF startup would inherit remote providers or data roots outside the profile THEN it SHALL reject them with an actionable message; the managed defaults SHALL not inherit the checkout's `.env` or its production credentials.
- R2.AC4: WHEN a second process targets the same profile or a port is occupied THEN it SHALL report the conflict without killing another process; on Ctrl+C, owned children and watchers SHALL stop and saved plugin data SHALL remain.

### R3: Save-to-preview loop

**User Story:** As an author, I want saved changes to appear automatically, so that iteration does not require packaging or administrative steps.

**Acceptance Criteria:**
- R3.AC1: WHEN development starts or relevant source, imported modules, assets, manifest/descriptors, authoring configuration, or lockfile content changes THEN the runner SHALL generate a new immutable candidate through the existing SDK pipeline; the standard starter's profile generation SHALL run automatically before building.
- R3.AC2: WHILE files are being saved THEN the runner SHALL debounce events by 150 ms, run at most one build, and retain at most one pending rebuild for the newest inputs; it SHALL discard a build if its inputs changed during generation/building.
- R3.AC3: WHEN generated outputs, dependencies, local development metadata, or profile artifacts change THEN those writes SHALL not create a self-triggering rebuild loop; dependency/build directories and local machine state SHALL be excluded from source snapshots, while generated authoring descriptors SHALL remain included.
- R3.AC4: WHEN a valid candidate with unchanged approved authority is ready THEN the connected browser SHALL automatically admit it, complete the real browser canary, promote its exact digest, request runtime reconciliation, and display the new plugin without file selection, a version bump, full-page reload, or manual canary/promote clicks.
- R3.AC5: WHEN the package digest is unchanged THEN the loop SHALL avoid admission/restart and keep the last admitted receipt associated with that package; it SHALL not pretend that a changed source-only snapshot was exercised as a new candidate.

### R4: Visible preview and failures

**User Story:** As an author, I want to see what is running and what failed, so that I can fix an edit without losing my place.

**Acceptance Criteria:**
- R4.AC1: WHEN the development host opens Chat THEN it SHALL automatically open the real plugin in a Chat workspace tab and announce development status accessibly: starting, building, checking, running, needs attention, or disconnected. Permission requests and failures SHALL appear in a compact dismissible panel; normal running SHALL not obscure the workspace. “Running” SHALL identify the digest actually activated, not merely built or promoted.
- R4.AC2: IF generation, build, validation, admission, or canary fails before promotion THEN the last selected package SHALL remain selected, the error and available source location SHALL be shown, and another save SHALL retry without restarting the command.
- R4.AC3: IF activation fails after promotion THEN Chat SHALL report the runtime failure and offer existing recovery controls; it SHALL not claim to have rolled back plugin data or silently perform a rollback.
- R4.AC4: WHEN a worker is replaced THEN its old contributions, outstanding callbacks, and activation handles SHALL be disposed; persistent plugin data, unrelated plugin activations, the surrounding host page, and supported workspace-scoped field drafts SHALL remain intact.

### R5: Permissions and setup only when necessary

**User Story:** As an author, I want ordinary edits to apply automatically while still seeing consequential access changes.

**Acceptance Criteria:**
- R5.AC1: WHEN initial admission or an edit needs a fresh authority review THEN Chat SHALL display the host-derived review and bind approval to the displayed package and authority digests; automatic progress SHALL pause until that review is resolved.
- R5.AC2: WHEN an edit retains approval under the existing effective-authority policy THEN it SHALL proceed without another permission prompt; the watcher SHALL not invent its own grant-equivalence rule.
- R5.AC3: IF required setup, dependencies, host compatibility, or state compatibility block promotion THEN the page SHALL expose the existing resolution flow or a precise blocker and resume the latest candidate after resolution; it SHALL not reset data, auto-migrate state, or perform the plugin's first destructive/paid action.

### R6: Development-only trust boundary

**User Story:** As an operator, I want automatic development loading confined to its local instance, so that convenience cannot enable unsigned production execution.

**Acceptance Criteria:**
- R6.AC1: WHEN any new development route is accessed THEN it SHALL require the existing development eligibility and administrator authorization; mutations SHALL retain the existing same-origin/intent checks, and production builds SHALL reject the route even with development flags set.
- R6.AC2: WHEN the browser requests build artifacts THEN it SHALL be able to read only the enumerated candidate files for a launcher-owned run and generation; arbitrary paths, traversal, symlink escapes, stale runs, and cross-origin reads SHALL be refused.
- R6.AC3: WHEN a build becomes selected THEN existing archive/receipt verification, grant review, setup/state checks, real browser canary evidence, package operation locks, and digest-bound promotion SHALL still apply; local provenance SHALL remain distinct from signed releases.
- R6.AC4: WHEN credentials or host-link metadata are generated THEN they SHALL stay in ignored local files with appropriate permissions and SHALL be excluded from candidates, logs, URLs, and exports, except for the local sign-in password deliberately printed to the developer's terminal.

### R7: Predictable operation over a development session

**User Story:** As an author, I want the loop to recover from common interruptions and extended editing without manual cleanup.

**Acceptance Criteria:**
- R7.AC1: WHEN two preview tabs are open THEN only one SHALL orchestrate mutations; other tabs SHALL observe. IF the controller closes, its replacement SHALL inspect current state and continue without promoting an older generation over a newer one.
- R7.AC2: IF the browser disconnects, authentication expires, a request is rate limited, or the host restarts THEN the page SHALL show the condition and resume from verified server state after recovery, processing the newest pending build and never manufacturing success from a lost response.
- R7.AC3: WHEN 60 successive valid starter edits are exercised THEN the loop SHALL not exhaust development admission limits, accumulate duplicate contributions, or retain an unbounded number of disposable candidates/package versions; selected, previous, pending, and actively used artifacts SHALL remain protected.
- R7.AC4: WHEN the warmed starter runs on a documented reference machine with the qualified browser visible THEN 20 ordinary code edits SHALL have a save-to-visible-update p95 of at most 3 seconds; initial host boot and dependency installation SHALL be measured separately. Failing this target SHALL trigger stage-level diagnosis without skipping checks.

### R8: Clear authoring and release documentation

**User Story:** As an author, I want one short getting-started path and an explicit finish step, so that I do not need to understand candidate machinery while coding.

**Acceptance Criteria:**
- R8.AC1: WHEN documentation is updated THEN the SDK README, starter instructions, local development guide, CLI reference, V2 development tutorial, quickstart entry, and `docmap.json` SHALL lead with create → `bun run dev` → edit, state the Bun/host-checkout prerequisite, and explain saved-state versus in-memory reload behavior.
- R8.AC2: WHEN the author prepares a submission THEN documentation SHALL direct them to create, verify, and qualify an explicit candidate using existing commands; disposable watch builds SHALL not be silently submitted, relabeled as release evidence, or published.
- R8.AC3: WHEN this feature is considered complete THEN an external-directory, fresh-profile browser smoke SHALL demonstrate the documented path without a checkout `.env`, external service credentials, manual uploads, or per-edit Admin actions.
