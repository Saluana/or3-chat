# Activity and External Agents

## Ownership model

Activity is a bounded, read/action projection over canonical subsystems. It does
not persist a second run ledger. Workflows, background chat, and
`or3-intern` continue to own their records, lifecycle, and terminal status.

Each source registers one stable ID, maps canonical records into normalized
summaries/details/events, advertises only real actions, and disposes its owned
registration during plugin/HMR cleanup. Source failures are isolated. Replayed
events are deduplicated, text is coalesced, and stale updates cannot replace a
terminal status.

## External-agent security

OR3 Chat never starts provider CLIs. A trusted `or3-intern` host owns runner
discovery, authentication, roots, flags, permission policy, sessions,
approvals, artifacts, and cancellation.

Both Nuxt clients use the framework-free `@or3/intern-client`. Credentials stay
in headers, errors are redacted, requests time out, and SSE reconnects with a
stable cursor and replay deduplication. Host switches abort old requests and
reject events from the prior host generation. Remote action failures preserve
the canonical prior state.

### Enrollment and storage boundary

OR3 Chat currently connects a pre-authorized host with a service-issued bearer
token; this is not secure QR/device pairing. It saves host metadata and an
opaque credential reference only. The default vault keeps the token in memory,
so reload requires reconnecting, while deployments can inject a platform
secure vault with `registerExternalAgentCredentialVault`. Tokens never enter
workspace KV, URLs, logs, or session references.

The shared client's secure pairing exchange returns an enrollment certificate,
not a request credential. Device signing/Noise key custody, certificate
persistence, and secure-session handshake/renewal are not yet implemented in
OR3 Chat, so this surface does not consume QR invites. That secure-session
adapter is the remaining connection limitation.

Canonical session discovery uses the exact active-workspace prefix
`or3-chat:<workspace-id>:` and merges host results with lightweight local refs;
full remote history stays in `or3-intern`.

## Extension flow

To add Activity support, adapt the existing source of truth, provide stable
event identity, dispatch actions back to its owner, register once, dispose the
handle, and test failure/reconnect/terminal behavior. Do not import editor or
page components as a lifecycle API.

To add a runner, implement and advertise it in `or3-intern`, add Go and shared
TypeScript contract tests, then verify the generic OR3 Chat UI using only
advertised capabilities. Unknown providers are never assumed executable.

## Troubleshooting and non-goals

A degraded source should not disable others. Reconnect an offline host before
retrying actions; install/authenticate unavailable runners on that host. Failed
approvals or cancellation remain retryable rather than forging terminal state.

Activity is not an event bus, scheduler, or durable ledger. External Agents is
not a terminal, shell endpoint, provider marketplace, planner, memory system,
or subagent orchestrator.
