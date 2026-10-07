# Activity and External Agent Boundaries

Use this guide when connecting a feature to Activity or extending the remote
agent integration. It explains which subsystem owns saved run state, remote
requests, credentials, and UI.

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

OR3 Chat never starts provider CLIs. A trusted agent host owns runner
discovery, authentication, roots, flags, permission policy, sessions,
approvals, artifacts, and cancellation. Intern hosts use the Intern protocol;
OpenClaw and Hermes use the Sessions/Runs protocol.

The installed `or3-plugin-external-agents` package owns the browser session
client, UI, and `@or3/intern-client` dependency. Credentials stay in headers,
errors are redacted, requests time out, and SSE reconnects with a stable
cursor and replay deduplication. Established streams also enforce a 60-second
inactivity deadline that resets on every byte (including heartbeat comments);
callers can override or explicitly disable it with `inactivityTimeoutMs`.
The host mediates HTTP and SSE requests to the selected host's saved URL.
Adding a host temporarily permits its URL during verification. Requests to
other destinations and redirects are rejected; HTTP responses are bounded.
Host switches abort old requests and reject events from the prior host
generation. Remote action failures preserve the canonical prior state.

The OR3 Connect server remains in the host. Its device status check uses
bounded authenticated HTTP health, readiness, and runner probes without a
browser client dependency. Disabling the External Agents package removes its
navigation and session UI while keeping Connect and saved workspace data.

### Enrollment and storage boundary

OR3 Chat currently connects a pre-authorized host with a service-issued bearer
token; this is not secure QR/device pairing. It saves host metadata and an
opaque credential reference only. The default vault keeps the token in memory,
unless the user explicitly remembers it with PIN encryption. After a reload,
opening a conversation from a locked host shows a PIN prompt in that pane,
unlocks the host encoded in the session reference, reconnects it, and restores
the conversation automatically. This keeps multiple saved hosts distinct.
Deployments can instead inject a platform secure vault with
`registerExternalAgentCredentialVault`. Tokens never enter workspace KV, URLs,
logs, or session references.

Remembered credentials use AES-256-GCM with a non-exportable key derived from
the PIN using PBKDF2-SHA-256, a random salt, and 600,000 iterations. Only
ciphertext, salt, IVs, and KDF parameters enter device-local storage. The PIN
must contain at least six digits; it is not equivalent to an OS keychain and
copied ciphertext permits offline guessing. Forgotten PINs cannot be recovered;
remove the saved ciphertext and re-enter the service token.

Historical panes wait for a host reconnect and retry when it becomes usable.
Re-enrollment at the same trusted endpoint can rebind lightweight references to
the active host identity. Opening a different host without a credential does not
tear down the currently healthy connection.

The shared client's secure pairing exchange returns an enrollment certificate,
not a request credential. Device signing/Noise key custody, certificate
persistence, and secure-session handshake/renewal are not yet implemented in
OR3 Chat, so this surface does not consume QR invites. That secure-session
adapter is the remaining connection limitation.

Canonical session discovery uses the exact active-workspace prefix
`or3-chat:<workspace-id>:` and merges host results with lightweight local refs;
full remote history stays in `or3-intern`.

Agent attachments follow the same host-owned boundary. OR3 Chat validates the
browser selection against its configured count and size limits, uploads each
file into a unique directory in the trusted host's writable `workspace` root,
and sends only canonical `workspace_ref` metadata with the turn. Uploads use
the same header credential resolver as runner-chat requests; file bytes and
tokens are not persisted in OR3 Chat session references.

Attachment staging has an explicit lifecycle: create a generated
`.or3-upload-<timestamp>-<random>` batch, upload all files, and roll back that
batch when an upload or known pre-start request fails. Once `startTurn` is
accepted, Chat leaves the batch available for the asynchronous runner. A
successful batch is retained until a future runner-owned, reference-counted
lifecycle can prove that consumption is complete. A host that predates the
release endpoint is kept compatible: Chat retains the files and surfaces a
cleanup warning instead of deleting a path it cannot prove is safe.

The transcript resolves the active theme's same `chat-message` component and
message-row geometry as primary Chat. Its composer uses the shared composer
shell in `lg` mode; primary Chat and Document AI use the same shell in `sm`
mode. The document editor also consumes the same `or3-prose` formatting
primitive, keeping readable content consistent across all three panes.

Codex and OpenCode model entries may advertise reasoning levels and a default.
The agent settings show those values only for the selected capable model and
send an explicit override as `thinking_level` on the next turn. Selecting Model
default omits the override so the runner retains its advertised default.

## Connecting OpenClaw or Hermes

Both services use the existing **Agents → Connection settings → Advanced**
form supplied by the installed External Agents package. OR3 detects the protocol
from `/v1/capabilities`; the user supplies only a URL and bearer token.

For OpenClaw, install `@or3/openclaw`, restart the Gateway, and connect to its
`/or3/` URL with the existing Gateway bearer token. Package-specific commands
and browser-origin configuration are documented in
[the OpenClaw bridge README](https://github.com/Saluana/or3-chat/blob/or3-cloud/packages/openclaw-or3/README.md).

The Hermes host needs no OR3 bridge plugin. Enable its API server in `~/.hermes/.env`:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=replace-with-a-long-random-value
API_SERVER_CORS_ORIGINS=http://localhost:3000
```

Run `hermes gateway`, then connect OR3 to `http://127.0.0.1:8642/` with the
value of `API_SERVER_KEY`. Change the CORS origin to OR3's exact browser origin;
when binding beyond loopback, use a trusted private network or HTTPS.

Streaming, slash commands, approvals, and stop requests all travel through the
same Runs client. Each runtime remains responsible for command authorization
and approval policy. Attachment controls appear only when a Runs service
advertises inline attachment support; OpenClaw does, while unsupported runtimes
keep the control hidden.

Runs capability discovery may also advertise a model catalog, per-model
thinking levels, and a command catalog. OR3 reuses the existing model/reasoning
picker, fills slash-command suggestions from that catalog, and renders bounded
command-choice buttons returned by the runtime. Mode, isolation, workspace,
and other settings stay hidden unless the selected runner explicitly supports
them.

## Transcript and approvals

The session pane shows responses, compact tool activity, approvals, and files.
Redacted transport diagnostics belong in the explicitly opened Technical details
disclosure and Activity. Activity is a Dashboard app rather than permanent
primary navigation.

Canonical ordered turn events reconstruct text and tool activity during live
execution and reload. A tool lifecycle retains one stable presentation item;
its progress and completion update that item. Sequence numbers are turn-local,
so do not sort or evict them as a session-global sequence. Only the live trailing
Markdown segment receives incomplete-Markdown repair.

Runner model IDs are submitted unchanged. The model catalog belongs to the
selected runner; do not mix catalogs or add provider prefixes. Missing models
should be investigated through Refresh agents and the runner's own discovery.

Native Codex and OpenCode approval requests appear inline when the runner and
host broker advertise support. Approve or Deny is sent to the owning runtime;
the resolved card remains in history. If the runner has already stopped, the
host can retain a fallback approval token, but the UI must not pretend execution
resumed. Failed approval or cancellation preserves canonical prior state.

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

## Installed package capabilities

External Agents 0.2 uses the public trusted SDK 2.1 UI, pane, Connect, profile, scoped storage/secret and governed transport clients. The package owns agent staging protocols. During upgrade, legacy connection and encrypted-vault bytes are copied and verified before originals are removed; saved origins require one host-owned access prompt. Disable resets Agent panes and retains workspace connection data. Sign-out clears device-local plugin credentials.
