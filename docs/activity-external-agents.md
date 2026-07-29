# Activity and External Agents

## Ownership model

Activity is a bounded, read/action projection over canonical subsystems. It does
not persist a second run ledger. Workflows, background chat, and
`or3-intern` continue to own their records, lifecycle, and terminal status.

Each Activity source:

- registers one unique, stable ID through the owned registry;
- maps canonical records into summaries, details, and normalized events;
- advertises only actions it can execute;
- returns its registration handle during plugin/HMR cleanup.

The aggregator isolates list, detail, subscription, and action failures by
source. Event identity is stable across reconnects, text deltas are coalesced,
and a stale event cannot replace a terminal state.

Activity is registered as a Dashboard app rather than permanent primary
navigation. Its responsive master-detail view keeps filters and run context
together; direct run references can still open in the shared pane system.

## External-agent security boundary

OR3 Chat never starts a provider CLI. A trusted `or3-intern` host owns runner
discovery, authentication checks, allowed roots, flags, sandbox/permission
policy, session state, approvals, artifacts, and cancellation.

The framework-free `@or3/intern-client` package is the protocol boundary for
both Nuxt clients. It:

- sends credentials in headers, never URLs;
- supports injected credential resolution and secure storage adapters;
- applies abortable timeouts and redacts secrets from errors;
- validates known fields while preserving future protocol fields;
- reconnects SSE with bounded backoff and a stable cursor;
- deduplicates replayed events.

Host changes abort old requests before incrementing the host generation. Events
from an earlier generation are ignored. Remote actions update local projections
only after `or3-intern` acknowledges them; a failed cancel or approval leaves
the canonical prior state visible with a retryable error.

### Connection enrollment and credentials

The current OR3 Chat surface enrolls a **pre-authorized host** with a
service-issued bearer token. It verifies health/capabilities, saves only host
metadata plus an opaque credential reference, and sends the token through the
shared client's authorization-header resolver. This is not secure QR/device
pairing.

The default browser credential vault is session-only unless the user explicitly
selects **Remember token on this device**. Remembered tokens are encrypted with
AES-256-GCM using a non-exportable key derived from the user's PIN with
PBKDF2-HMAC-SHA-256 (600,000 iterations and a random salt). Only ciphertext,
salt, IVs, and KDF parameters enter device-local browser storage. The PIN and
derived key remain in memory and must be supplied again after a reload.

PIN protection does not make low-entropy PINs equivalent to an OS keychain. An
attacker who copies browser storage can attempt guesses offline, so the UI
requires at least six digits and displays an explicit warning. Forgotten PINs
cannot be recovered; the saved ciphertext can only be removed and the access
token re-entered.

Deployments with a native or platform secure store can replace the browser
fallback with `registerExternalAgentCredentialVault`. Raw tokens never enter
workspace KV, sync, exports, URLs, logs, session references, conversations, or
Activity.

`@or3/intern-client` exposes the secure pairing approval exchange, but that
exchange returns an enrollment certificate rather than a bearer credential. A
usable paired connection also needs device signing/Noise key custody,
certificate persistence, and secure-session handshake/renewal. OR3 Chat does
not yet implement that secure-session adapter, so it deliberately does not
consume secure QR invites. This remains the connection layer's explicit
limitation.

Session discovery is scoped to the active workspace with
`or3-chat:<workspace-id>:` application-session keys. Rehydration merges the
host's canonical scoped session list with lightweight local references; remote
history is never copied into workspace storage.

Agent attachments follow the same host-owned boundary. OR3 Chat validates the
browser selection against its configured count and size limits, uploads each
file into a unique directory in the trusted host's writable `workspace` root,
and sends only canonical `workspace_ref` metadata with the turn. Uploads use
the same header credential resolver as runner-chat requests; file bytes and
tokens are not persisted in OR3 Chat session references.

Historical panes wait for an in-progress host reconnect and retry automatically
when the connection becomes usable. If a re-enrolled service advertises a new
host identity at the same trusted endpoint, lightweight session references are
rebound to the active identity. Attempting to open a session whose distinct host
has no credential does not tear down the currently healthy connection.

When a historical session belongs to a host whose remembered credential is
PIN-locked after reload, the conversation pane shows an inline PIN unlock
instead of an unavailable-host error. The unlock targets the host encoded in
that session reference, reconnects that host, and then hydrates the
conversation automatically. This keeps multiple saved hosts distinct while the
shared PIN-derived vault key remains in memory for the current browser session.

## Adding an Activity source

1. Keep the subsystem's current store as the source of truth.
2. Implement `ActivitySource` list/detail mapping and, if available, a
   lifecycle subscription.
3. Give every event a stable source/run/event identity and chronological
   timestamp.
4. Advertise only implemented actions, then dispatch them back to the owning
   subsystem.
5. Register once from a Nuxt plugin and dispose the returned handle on app
   unmount and HMR.
6. Test duplicate registration, source failure, reconnect replay, terminal
   precedence, and cleanup.

Do not import a feature's editor or page component merely to read lifecycle
state. Expose a framework-free read boundary first; this is why Document AI is
not an initial Activity source.

## Adding a runner

Runner support belongs in `or3-intern`, not OR3 Chat:

1. implement discovery and execution in the service;
2. advertise runner, model, mode, isolation, approval, and cancellation
   capabilities;
3. add Go contract fixtures and service tests;
4. update the shared TypeScript protocol tests;
5. verify the generic launcher and session pane using only advertised
   capabilities.

Unknown providers and capabilities remain visible as protocol data but are not
assumed safe or executable.

## What users see

Agents are conversations with the ability to act. The normal session pane shows
the instruction, response, compact tool activity, approvals, and files. It does
not show transport events, request IDs, endpoints, or provider payloads.
Operational events remain available through Activity and the explicitly opened,
redacted **Technical details** disclosure.

Assistant turns are reconstructed from the canonical ordered turn-event stream,
not from a flattened final response. Text segments and tool calls therefore
remain in provider order during live execution and after reconnect or reload:

    assistant text → tool lifecycle → assistant text → next tool

One tool lifecycle keeps one stable presentation item; progress and completion
update it in place. The service persists each normalized event before broadcast,
while the client paginates canonical events and bounds them per turn. Event
sequence numbers are turn-local and must never be sorted or evicted as one
session-global sequence. The transcript uses the same bottom-anchored
`Or3Scroll` surface as Chat and refreshes virtual measurements when tool details
expand or collapse. Only the live trailing Markdown segment receives
incomplete-Markdown repair.

The New Agent screen uses the selected runner's live model catalog from
`GET /internal/v1/chat-runners`. Model IDs are runner-owned and are submitted
unchanged. For example, Codex advertises and receives `gpt-5.6-luna`; OR3 must
not rewrite it as `openai/gpt-5.6-luna`. Provider names are display metadata
that help people browse the searchable, virtualized model list. A model appears
only when that runner currently advertises it; OR3 does not merge one
provider's catalog into another.

Connection management and execution controls are secondary:

- a new run normally needs only an instruction;
- runner, model, permissions, and workspace live in the composer settings;
- host enrollment and token storage live in Connection settings;
- healthy-but-partially-supported hosts do not produce a persistent warning
  when at least one usable agent is available.

The transcript resolves the active theme's same `chat-message` component and
message-row geometry as primary Chat. Its composer uses the shared composer
shell in `lg` mode; primary Chat and Document AI use the same shell in `sm`
mode. Typography, focus treatment, and shell styling therefore stay aligned
without duplicating pane-specific CSS.

## Approval behavior

Codex and OpenCode both advertise inline approval decisions when their native
runtimes and the host approval broker are available.

1. The runner pauses before a protected action.
2. `or3-intern` evaluates the request and emits one normalized approval event.
3. OR3 renders one inline card with **Approve** and **Deny**.
4. Approve authorizes the broker request and responds to the still-running
   native Codex or OpenCode session.
5. Deny closes the request and the affected turn without performing the action.
6. The resolved card remains in history, and a pending badge appears in Agents
   and Activity.

If the native runner has already stopped, `or3-intern` preserves the broker
decision as a fallback token rather than pretending the action resumed. OR3
shows a concise retryable error and keeps the canonical prior state.

## Troubleshooting

- **One source is degraded:** inspect that source diagnostic; other sources
  should remain usable.
- **Duplicate timeline rows:** verify the adapter supplies a stable event ID or
  sequence and that reconnect resumes from the last cursor.
- **Agent host is offline:** reconnect the saved trusted host and re-check
  health, readiness, and runner capabilities.
- **Runner is unavailable:** install/authenticate it on the host and refresh
  discovery. OR3 Chat cannot repair a provider CLI.
- **A model is missing:** open Agent connections and choose **Refresh agents**.
  The service asks each native runner for its current model catalog. Update or
  authenticate that runner if its own catalog still omits the model.
- **Approval or cancel failed:** retry after connection recovery. The UI
  intentionally does not forge a terminal state.
- **Provider credits are unavailable:** reconnect or fund that provider, or
  choose another advertised model. Permission UI cannot be exercised until the
  provider starts the turn.

## Non-goals

Activity is not an event bus, scheduler, or durable history store. External
Agents is not a terminal, shell endpoint, provider marketplace, planner,
memory system, or subagent orchestrator.
