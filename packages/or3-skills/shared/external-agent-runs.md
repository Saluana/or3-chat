# External agent Runs connections

OpenClaw and Hermes connections use the runtime's authenticated `GET /v1/capabilities` document.
Use the runtime-specific base URL, a bearer credential in the authorization header, and an exact browser-origin allowlist.

## Credential and network boundaries

- Never expose tokens in URLs, chat, commits, shell history, screenshots, or reports.
- Generating/persisting a new credential or enabling **Remember token on this device** requires user authorization.
- Store credentials in the runtime's supported secret/config location.
- Manual connections keep the token in the browser; guided Connect uses OR3 Cloud's encrypted workspace-scoped credential envelope.
- Keep local runtimes on loopback; remote exposure requires authorization, HTTPS or a trusted private network, and restricted origins.
- Origins include scheme and port; `localhost` and `127.0.0.1` are distinct, and wildcard CORS is not a workaround.

## Connection and verification

After runtime health and authenticated capability checks pass, add the URL/token through **Agents → Connection settings → Advanced**.
Select the connected host before creating a session; existing sessions remain owned by the runtime that created them.

Verify incremental text, advertised commands/features, and cancellation that retains partial output and releases the composer.
Diagnose the first failing layer:

| Symptom | Check |
| --- | --- |
| Host unavailable | Process, base URL/path/port, bearer credential, authenticated capabilities |
| Browser-only failures | Exact CORS origin and runtime restart |
| Final-only responses | SSE CORS and proxy buffering before adding polling/timeouts |
| Missing controls | Runtime-advertised capabilities and model/provider configuration |
| Updates appear ignored | Loaded runtime registration and service restart |

The external runtime owns approvals, execution policy, models, tools, and files.
Only claim policy enforcement that the runtime advertises and implements.
Report non-secret status and verification using [completion guidance](./completion-contract.md).
