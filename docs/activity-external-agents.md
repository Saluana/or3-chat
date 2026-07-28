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

The default browser credential vault is intentionally memory-only, so a full
reload requires the user to enter the token again. Deployments with a native or
platform secure store can inject it with
`registerExternalAgentCredentialVault`; raw tokens never enter workspace KV,
URLs, logs, or session references.

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

## Troubleshooting

- **One source is degraded:** inspect that source diagnostic; other sources
  should remain usable.
- **Duplicate timeline rows:** verify the adapter supplies a stable event ID or
  sequence and that reconnect resumes from the last cursor.
- **Agent host is offline:** reconnect the saved trusted host and re-check
  health, readiness, and runner capabilities.
- **Runner is unavailable:** install/authenticate it on the host and refresh
  discovery. OR3 Chat cannot repair a provider CLI.
- **Approval or cancel failed:** retry after connection recovery. The UI
  intentionally does not forge a terminal state.

## Non-goals

Activity is not an event bus, scheduler, or durable history store. External
Agents is not a terminal, shell endpoint, provider marketplace, planner,
memory system, or subagent orchestrator.
