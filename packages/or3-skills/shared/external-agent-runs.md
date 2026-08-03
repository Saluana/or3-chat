# External agent Runs connections

Use this reference when connecting an external agent runtime to OR3 Chat.
It applies to the OpenClaw and Hermes setup skills.

## Connection contract

OR3 connects directly from the browser to a runtime that advertises Runs
capabilities at `GET /v1/capabilities`. The connection form needs:

- a host URL, including the runtime-specific base path when required;
- a bearer token, sent in an authorization header; and
- a browser-origin allowlist on the runtime that includes OR3 exactly.

Do not put a token in a URL, chat, commit, shell history, or screenshot. Ask
before generating or persisting a new credential. Store it in the runtime's
normal secret/config location; use OR3's **Remember token on this device**
option only with the user's approval. Tokens never need to be sent to OR3
Cloud.

`http://localhost:3000` and `http://127.0.0.1:3000` are different CORS
origins. Copy the origin from the address bar exactly, including its scheme and
port. Keep a locally used runtime bound to loopback. Before exposing one beyond
loopback, get approval, use HTTPS or a trusted private network, and restrict
the bearer credential and origin list.

## Connect in OR3 Chat

1. Start the external runtime and wait for its health/status check to pass.
2. In OR3 Chat, open **Agents → Connection settings → Advanced: add another
   host by URL and token**.
3. Enter a clear name, the documented host URL, and the bearer token. Save and
   connect.
4. Verify that OR3 identifies the host, opens a new agent session, and shows
   the runtime's advertised model and command choices.

Multiple trusted hosts can stay unlocked simultaneously. Use the connected-host
selector at the bottom of the Agents sidebar to switch which host new sessions
use. Do not switch a running conversation to another host: sessions stay owned
by the runtime that created them.

## Verification checklist

Run these in order after setup. Stop at the first failure and diagnose that
layer instead of changing unrelated settings.

1. Open the runtime's capabilities endpoint with an authenticated request and
   confirm it returns its Runs capability document.
2. Connect it in OR3 and confirm the host is healthy.
3. Send a short prompt. Text should appear while the response is still running,
   not only after completion.
4. Use one advertised slash command. It should open a command suggestion list,
   and any bounded choices returned by the runtime should be clickable.
5. Start a response that invokes a harmless tool or takes a few seconds, then
   stop it. The partial transcript should remain and the composer should become
   usable again.

## Common failure patterns

| Symptom | Likely cause and next action |
| --- | --- |
| OR3 cannot connect or says the host is unavailable | Confirm the process is running, the URL includes the correct port/path, and the supplied bearer token is the runtime's API/Gateway token. |
| Connection works but browser requests fail with CORS | Add the exact OR3 browser origin to the runtime allowlist, restart it, then inspect the browser Network panel. Do not use a token in a query string or a wildcard origin as a workaround. |
| The UI stays at “Generating” and shows final text all at once | Test the runtime's SSE events endpoint in the browser. It is usually an event-stream CORS/proxy/buffering issue, not a reason to add polling or a longer heartbeat. |
| Models, thinking levels, commands, attachments, or mode controls are absent | OR3 only shows features advertised by the selected runtime. Check the runtime's capabilities and model/provider configuration; do not fabricate controls in OR3. |
| A runtime update seems ignored | Restart the runtime after changing its plugin, server, CORS, model, or environment configuration. |

## Runtime ownership

The external runtime remains responsible for its own approvals, command policy,
models, tool execution, and files. OR3 renders those events and sends approved
actions back through the Runs API. Never claim that an OR3 control enforces a
runtime policy unless the runtime advertises and implements it.
