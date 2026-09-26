# Requirements

## Introduction

Make OR3 plugins practical to build as independent products through a small, coherent host SDK. Developers should compose supported capabilities without importing OR3 database helpers, composables, stores, runtime configuration, or internal services. This work completes production integration as well as authoring contracts; extracting Agents is the principal proof, with a small non-agent application proving that the SDK is general purpose.

## Context

Inspected `or3-chat` branch `or3-marketplace` at `3c0f8f87` on 2026-09-20; the checkout was clean. The application uses TypeScript, Nuxt 4/Vue 3, Bun and `bun.lock`, workspace-scoped Dexie, provider-backed Cloud storage/auth, Vitest and Playwright. `packages/plugin-sdk` has Manifest V2, result types, lifecycle, settings/storage, contribution contracts, portable UI, AI helpers, a CLI and two test-host surfaces. The production portable path already invokes `setup()` through `createPortablePlugin()`, mediates settings/storage/model/connection operations, renders workspace UI, and registers client tools. This differs from the broad warnings in some documentation: generic V2 trusted client activation, portable activation, and individual qualified capabilities must be assessed separately. Existing grant qualification, activation identity, contribution registries, connection encryption, file storage, activity projections, pane navigation and release lifecycle remain the implementation foundations.

## Assumptions

- This deliverable is a plan. It does not authorize implementation, publication, version bumps or production changes.
- The public context keeps the requested namespaces: `ai`, `ui`, `panes`, `commands`, `chat`, `workspace`, `storage`, `settings`, `secrets`, `files`, `http`, `network`, `activity`, `events`, and `logger`. Existing identity, features, grants and lifecycle helpers remain available.
- Existing `PluginResult<T>` is the normal asynchronous error contract. Examples must show its actual behavior rather than imply synchronous storage or silently throwing host calls.
- Marketplace code remains isolated by default. Framework-free host services and optional UI conveniences do not expose host Vue/Nuxt objects. Authors may bundle their own framework in an explicitly qualified custom-UI profile.
- The default data scope is the current plugin and workspace. Secrets additionally belong to the acting user; user preference settings are distinct from workspace configuration. No global cross-workspace data access is added.
- Local/static usage must preserve existing Agents functionality. SSR-only services report unsupported capability; introducing an offline marketplace installer is outside this project.
- Host-rendered UI is the first release path. Contained custom UI is an explicit subsequent milestone of this plan, not an implied claim that today's portable profile accepts arbitrary HTML or dependencies.
- Long-running means while the host session is alive. Browser-close survival and scheduled execution require a separate durable runtime project.
- Existing package acquisition/promotion work in `planning/marketplace-release-lifecycle/` is reused. It is not replaced by another install/update state machine.

## Out of Scope

- Exposing Dexie, Pinia, Nuxt injection, internal HTTP routes, provider credentials or mutable host registries.
- Rebuilding Agents provider protocols, adding a scheduler, changing secure pairing, or making Activity a job database.
- Shell execution, unrestricted OS paths, arbitrary server code as a networking workaround, or silent escalation to trusted-host execution.
- Rewriting frozen V1 plugins, changing existing connection consent rules, automatic data rollback or deletion of legacy Agents data.
- A new plugin framework, global event bus for third-party plugins, generic database/query language, new service fleet or speculative caches.

## Requirements

### R1: One understandable public SDK

**User Story:** As a plugin developer, I want one typed context and consistent operation semantics, so that building a feature does not require learning OR3 internals.

**Acceptance Criteria:**
- R1.AC1: WHEN a plugin activates THEN each documented namespace SHALL be accessible through the context, with unsupported optional capabilities returning an explicit unsupported result and missing required features blocking activation.
- R1.AC2: WHEN a host operation fails THEN it SHALL return the documented `PluginResult` code with safe details; registration errors during setup SHALL fail activation without partial contributions.
- R1.AC3: WHEN a package is validated THEN app aliases, Nuxt auto-import reliance, private host entry points and unbundled runtime imports SHALL be rejected with a source location and suggested public capability where one exists.
- R1.AC4: WHEN a capability is advertised THEN its published contract, production adapter, authorization, teardown behavior, test-host behavior and installed-package qualification SHALL all exist.

### R2: Identity, permissions and lifecycle

**User Story:** As a workspace user, I want plugins confined to their approved authority and lifetime, so that changes of workspace or plugin version cannot leak data or leave stale effects.

**Acceptance Criteria:**
- R2.AC1: WHEN an operation runs THEN the host SHALL derive plugin, user, workspace, version/digest and activation generation from host-owned state and enforce approved grants at the side-effect boundary.
- R2.AC2: WHEN a plugin is disabled, replaced, revoked, crashes or loses its workspace/session THEN owned registrations, requests, file handles and streams SHALL be disposed; late replies SHALL NOT mutate a new activation.
- R2.AC3: IF setup fails THEN its staged registrations SHALL be withdrawn together; repeated disposal SHALL be harmless and one cleanup failure SHALL NOT prevent other cleanup.
- R2.AC4: WHEN an update expands authority THEN existing review SHALL NOT approve the new grants, destinations, secret access or operations automatically.

### R3: Useful UI without private components

**User Story:** As a developer, I want to build sidebar pages, panes, cards and controls, including rich application UI, without importing host components.

**Acceptance Criteria:**
- R3.AC1: WHEN an installed isolated plugin registers a sidebar page/section, pane app, dashboard card or supported action button THEN the corresponding host surface SHALL display it and invoke its mediated handler.
- R3.AC2: WHEN a developer builds an agent conversation THEN public host-rendered transcript, composer, attachment, approval and progress primitives SHALL cover the required Agents interactions and inherit host theme/accessibility behavior.
- R3.AC3: WHEN a package declares the qualified custom-UI feature THEN it SHALL render bundled HTML/CSS/JS in its own contained document, use the same host context, and be unable to access the parent DOM, cookies, host storage or unrestricted network.
- R3.AC4: WHEN keyboard, narrow-pane and screen-reader checks run THEN labels, focus order, dialog containment, Escape behavior, focus restoration and theme contrast SHALL meet the host's existing UI conventions.
- R3.AC5: IF a UI profile is unsupported THEN installation preflight SHALL identify that profile; it SHALL NOT substitute trusted host execution.

### R4: Independent pane instances and navigation

**User Story:** As a plugin user, I want sessions to open, focus and restore correctly across tabs and splits.

**Acceptance Criteria:**
- R4.AC1: WHEN `panes.open({ app, data, instanceKey })` is called THEN the host SHALL return an opaque pane ID and honor the documented focus-existing/new/replace-active policy.
- R4.AC2: WHEN two sessions are open side by side THEN each pane SHALL receive its own validated data, render state and events; changing one SHALL NOT change the other.
- R4.AC3: WHEN a workspace layout reloads THEN eligible panes SHALL restore using small versioned JSON references, without persisting credentials, transcripts or file bytes in layout state.
- R4.AC4: IF an app is missing, data is invalid, navigation is denied or the pane limit is reached THEN the caller SHALL receive a defined error and the current pane SHALL remain intact.

### R5: Commands that work after marketplace installation

**User Story:** As a developer, I want a single command registration to work in the palette, plugin UI and tests.

**Acceptance Criteria:**
- R5.AC1: WHEN a plugin registers a namespaced command THEN it SHALL appear in the real palette with its label and availability state; execution SHALL route to the active plugin handler.
- R5.AC2: WHEN an invocation is cancelled or a command is unavailable THEN `commands.run()` SHALL return the documented result; duplicate IDs SHALL be rejected rather than replacing another owner's command.
- R5.AC3: WHEN plugin UI invokes another owner's command THEN the host SHALL require an explicitly public command and its execution authority; command IDs SHALL NOT bypass protected actions.

### R6: Persistent plugin data

**User Story:** As a developer, I want workspace-scoped persistence that survives reloads and updates without managing a database.

**Acceptance Criteria:**
- R6.AC1: WHEN a plugin uses storage get/set/delete/list THEN keys SHALL be isolated by plugin and captured workspace, with documented JSON/value/key/total quota limits and paginated listing.
- R6.AC2: WHEN overlapping updates change a stored value THEN revision-based compare-and-set SHALL detect conflicts so callers cannot silently overwrite another tab's update.
- R6.AC3: IF quota, serialization, persistence or workspace-lifecycle checks fail THEN the previous committed value SHALL remain valid and the caller SHALL receive an explicit failure.
- R6.AC4: WHEN a plugin is disabled or upgraded THEN storage SHALL remain; destructive deletion SHALL occur only through an explicit host data-removal action, with compatibility checked by the existing package state contract.

### R7: User-editable settings

**User Story:** As a plugin user, I want validated preferences and workspace configuration with predictable scope.

**Acceptance Criteria:**
- R7.AC1: WHEN a settings schema is installed THEN the host SHALL render defaults, validation, descriptions and workspace/user scope; existing schemas SHALL retain their current workspace semantics.
- R7.AC2: WHEN a setting changes THEN affected activations SHALL receive a typed change event; `get`, `set` and `delete` SHALL obey schema and role rules, with delete resetting to its documented default.
- R7.AC3: IF a schema requests credential entry THEN the host SHALL route it to the secret/connection flow; plaintext credentials SHALL NOT be saved as ordinary settings.

### R8: Host-owned secrets

**User Story:** As a developer, I want secure token custody without implementing my own vault or losing users' saved credentials.

**Acceptance Criteria:**
- R8.AC1: WHEN a secret is set/get/deleted THEN access SHALL be limited to its plugin, acting user and workspace; reading plaintext SHALL require an explicit secret-read grant.
- R8.AC2: WHEN a network request uses a secret reference or managed connection THEN the host SHALL inject credentials only for its approved destination; managed provider credentials SHALL never be exposed by `secrets.get()`.
- R8.AC3: WHEN persistence is unavailable or the vault is locked THEN the API SHALL distinguish locked, unavailable and missing states; it SHALL NOT fall back to plaintext or falsely claim persistence.
- R8.AC4: WHEN the browser-only vault is used THEN session memory SHALL be the default, remembered secrets SHALL use host-controlled encrypted persistence/unlock, and sign-out/lock SHALL clear decrypted state and cancel affected connections.
- R8.AC5: WHEN credentials are rotated, deleted or migrated THEN new requests SHALL use the current revision, ordinary logs/exports/backups of plugin data SHALL exclude plaintext, and migration SHALL preserve a recoverable legacy copy until verified.

### R9: Files and attachments

**User Story:** As a developer, I want to select, read, create and attach workspace files without handling storage-provider details.

**Acceptance Criteria:**
- R9.AC1: WHEN the user picks files THEN the host SHALL return scoped opaque references and safe metadata, or an explicit cancelled selection; picker access SHALL NOT imply access to all workspace files.
- R9.AC2: WHEN files are read, written or attached THEN the host SHALL enforce ownership, grants, count/size limits and cancellation, support bounded chunk transfer, and preserve existing local-first transfer behavior.
- R9.AC3: WHEN an existing file is replaced THEN the API SHALL require its expected revision; denied or interrupted writes SHALL NOT leave a partially visible file.
- R9.AC4: WHEN attachments are uploaded to an external agent THEN plugin adapters SHALL retain remote staging/acceptance/cleanup semantics; the SDK SHALL provide file access and transport without pretending it owns remote runner retention.
- R9.AC5: IF a handle expires, points to another workspace or requests an OS path THEN the operation SHALL fail without disclosing data outside the approved selection.

### R10: Practical governed HTTP and connections

**User Story:** As a developer, I want to call my service or use a standard client library without requiring a new OR3 provider implementation for every API.

**Acceptance Criteria:**
- R10.AC1: WHEN `http.fetch()` calls an approved destination THEN the host SHALL support documented methods, headers, JSON/text/binary/multipart bodies and bounded responses while enforcing destination/path/method/credential policy.
- R10.AC2: WHEN an SDK fetch adapter is passed to `@or3/intern-client` THEN ordinary requests, attachment upload, streamed bodies and AbortSignal SHALL operate without raw sandbox network access.
- R10.AC3: WHEN a connection targets localhost or a private network THEN the host SHALL distinguish the user's browser reachability from the server's reachability and require a specific approved endpoint; broad private-network proxying SHALL remain unavailable.
- R10.AC4: WHEN redirects, credentials, DNS/address changes or unknown protocols are encountered THEN the shared host transport SHALL enforce its documented policy before connecting or forwarding credentials; generic HTTP SHALL NOT expose authenticated internal OR3 routes.
- R10.AC5: WHEN Agents requests Cloud connection discovery or management THEN a documented scoped host surface SHALL supply safe metadata or open the host-owned management flow, without plugin access to session cookies, runtime config or private Connect routes.

### R11: Streaming and duplex connections

**User Story:** As a developer, I want SSE, streamed HTTP and WebSocket connections that I can cancel and test without writing transport infrastructure.

**Acceptance Criteria:**
- R11.AC1: WHEN `network.stream()` opens an SSE or byte stream THEN it SHALL return an async consumer with status/headers, cancellation and typed terminal outcome; partial UTF-8/SSE frames SHALL be decoded correctly.
- R11.AC2: WHEN reconnection is enabled THEN the API SHALL use bounded attempts, backoff and cursor rules; it SHALL NOT replay non-idempotent requests or promise exactly-once delivery.
- R11.AC3: WHEN a stream stalls, exceeds its byte/queue limit, loses permission or has no remaining owner THEN it SHALL terminate with a defined reason and release the upstream connection.
- R11.AC4: WHEN a healthy application session lasts more than the current portable 120-second activation limit THEN its declared long-lived capability SHALL remain usable under bounded rolling transport/work budgets; stalled code SHALL remain terminable.
- R11.AC5: WHEN `network.connect()` opens a supported WebSocket THEN send/receive, bounded buffering, close codes and cancellation SHALL work through the same policy boundary; unsupported hosts SHALL advertise the missing feature before activation.

### R12: Workspace lifecycle and typed events

**User Story:** As a developer, I want workspace identity and documented events without observing internal database or auth state.

**Acceptance Criteria:**
- R12.AC1: WHEN setup runs THEN `workspace.id` SHALL identify the immutable scope of that activation; workspace switching SHALL invalidate that context and create a new context after the host commits the new workspace.
- R12.AC2: WHEN `workspace.onChange()` or `events.on()` subscribes THEN listeners SHALL receive documented plain-data payloads and disposable handles; correctness SHALL NOT depend on a final callback reaching a terminated worker.
- R12.AC3: WHEN public chat-created/message-created, connection-change, settings-change or host-resume events are emitted THEN payloads SHALL be scoped and permission-filtered; broad internal hooks SHALL NOT expose unapproved content.
- R12.AC4: WHEN a plugin requests a workspace switch THEN the host SHALL use its existing membership/confirmation flow and deny unauthorized targets, without granting cross-workspace data reads.

### R13: Governed AI and models

**User Story:** As a developer, I want to use OR3's configured models and limits without obtaining the user's model-provider key.

**Acceptance Criteria:**
- R13.AC1: WHEN `ai.models()` or `ai.complete()` is called THEN the context SHALL use the existing governed catalog/completion implementation, preserve model availability, real usage/spend and refusal details, and expose no provider secret.
- R13.AC2: WHEN AI streaming is supported THEN cancellation and partial output SHALL use the shared stream lifecycle and final usage accounting; an interrupted call SHALL NOT be reported as a zero-cost success.
- R13.AC3: IF a model or modality is not supported by the host THEN capability discovery SHALL disclose that limitation before execution; raw HTTP SHALL NOT bypass governed access to host model credentials.

### R14: Chat and existing extension capabilities

**User Story:** As a developer, I want to create/open chats, add messages, register tools and extend supported editor/action surfaces without copying host business logic.

**Acceptance Criteria:**
- R14.AC1: WHEN chat create/open/append operations run THEN the host SHALL enforce resource access, message validation, file references and retry-safe request IDs through existing chat services.
- R14.AC2: WHEN a plugin registers a chat tool or action THEN production discovery, enablement, invocation, cancellation and teardown SHALL use the existing permission-mediated tools/action paths; tools SHALL NOT enable themselves.
- R14.AC3: WHEN public editor actions, inspector panels or document AI actions are supported THEN they SHALL be typed contributions using host adapters; arbitrary host-executed editor code SHALL remain an explicitly unsupported marketplace capability until separately qualified.
- R14.AC4: WHEN a chat read/subscription grant is absent THEN events and navigation SHALL NOT disclose message bodies; app navigation SHALL NOT grant write permission.

### R15: Activity, notifications and diagnostics

**User Story:** As a developer, I want to expose long operations and errors through OR3's existing UI without creating a separate activity system.

**Acceptance Criteria:**
- R15.AC1: WHEN `activity.registerSource()` is used THEN the host SHALL display namespaced summaries/details/events and dispatch only advertised actions to the owning plugin, preserving deduplication and terminal-state rules.
- R15.AC2: IF one source fails or detaches THEN other sources SHALL continue; the host SHALL NOT invent completion or persist a duplicate run ledger.
- R15.AC3: WHEN `ui.toast()`, `ui.confirm()` or `ui.progress()` is used THEN the host SHALL render accessible bounded UI; ordinary confirmation SHALL NOT mint security/action approvals.
- R15.AC4: WHEN a host failure is reported THEN logger/inspector output SHALL identify plugin, capability, safe error code and correlation ID without credentials or complete sensitive request bodies; authors SHALL be able to reproduce the failure in the harness.

### R16: A production-representative test host

**User Story:** As a developer, I want to install my plugin, run commands and assert observable state without starting OR3.

**Acceptance Criteria:**
- R16.AC1: WHEN `createTestHost().install(plugin)` runs THEN it SHALL execute the real SDK setup and dispatch path, exposing scoped storage, panes, contributions, notifications, activity and command invocation for assertions.
- R16.AC2: WHEN tests simulate two workspaces/plugins, denied grants, vault locking, file selection, network failure, stream reconnect or activation replacement THEN the harness SHALL exercise production validators and lifecycle semantics with deterministic clocks/transports.
- R16.AC3: IF a capability is not configured in a test THEN it SHALL fail explicitly rather than return fabricated success; tests SHALL have no live network, paid model usage or real credential dependency by default.
- R16.AC4: WHEN shared conformance cases run against the harness and real installed package THEN differences in permission, result, registration or teardown behavior SHALL fail qualification.

### R17: Standalone development and honest documentation

**User Story:** As a new developer, I want to scaffold, build, test, preview and package a working plugin outside the OR3 repository.

**Acceptance Criteria:**
- R17.AC1: WHEN a starter is created from the distributed SDK THEN documented CLI steps SHALL produce a tested installable package with a working command, pane and persistence without sibling aliases or a shared node_modules directory.
- R17.AC2: WHEN a supported development host is available THEN the documented preview/watch workflow SHALL replace the plugin activation with cleanup and display its actual capability/permission failures through existing candidate tooling.
- R17.AC3: WHEN docs name a capability THEN they SHALL state its supported runtime/profile, grants, scope, limits, failure behavior and tested example; current contracts SHALL be distinguished from production-qualified surfaces.
- R17.AC4: WHEN implementation ships THEN `public/_documentation/` and `docmap.json`, SDK README, affected provider READMEs and package release integration SHALL be updated; package publication SHALL follow `docs/releasing.md` and exact registry qualification.

### R18: Agents extraction with feature and data parity

**User Story:** As an Agents maintainer, I want Agents to be a standalone SDK consumer without losing existing sessions, attachments or Cloud connections.

**Acceptance Criteria:**
- R18.AC1: WHEN Agents builds in a clean external directory THEN its complete dependency graph SHALL have zero OR3 private imports, Nuxt globals, raw host fetches or direct host registry/database access.
- R18.AC2: WHEN installed through the real V2 package path THEN local and Cloud connection discovery, secret unlock, session list/resume, two independent session panes, streaming/reconnect/cancel, approvals, model selection, attachment staging and Activity navigation SHALL pass parity scenarios using deterministic provider fixtures.
- R18.AC3: WHEN legacy metadata and encrypted credentials are migrated THEN a host-owned idempotent bridge SHALL verify scoped copies, preserve references and retain old data for rollback; ordinary plugin code SHALL NOT receive a temporary database escape hatch.
- R18.AC4: WHEN rollout is reversed THEN only one Agents implementation SHALL be active, the legacy data SHALL remain usable, and no rollback SHALL claim to restore remote actions or post-migration data automatically.
- R18.AC5: WHEN a non-agent reference app is built THEN it SHALL use the same SDK to open a pane, persist data, pick a file and call a declared service without introducing an app-specific host API.
