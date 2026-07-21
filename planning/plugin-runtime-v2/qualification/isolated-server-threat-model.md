# Isolated-server threat model

**Decision:** use a **child process** boundary for Node SSR isolated-server
plugins. Do not rely on same-process VM/isolate tricks as the security
boundary on supported deployments.

## Threats

| Threat | Child-process control | Notes |
| --- | --- | --- |
| Read host secrets from `process.env` | Deny-by-default env allowlist; child started with a scrubbed env | Host never forwards undeclared keys |
| Read host filesystem (`/etc`, app `.env`, package store) | Deny-by-default fs allowlist mediated by host RPC | No ambient `fs` grant |
| Open undeclared network targets | Deny-by-default host/protocol allowlist on mediated `network.http` | Direct sockets in the child are out of policy and treated as escape attempts in adversarial tests |
| CPU / event-loop exhaustion of the host | Per-request CPU and wall budgets; host kills the child on breach | Wall budget is hard; CPU is attributed work reported/enforced at the broker |
| Memory bombs | Per-runtime RSS/heap ceiling; terminate offending runtime only | Does not reclaim host heap stolen before kill |
| Oversized request/response | Byte budgets on RPC envelopes | Enforced before handler side effects where possible |
| Spoofed plugin / workspace identity | Host-bound identity on every RPC; plugin-supplied IDs ignored | Same broker rule as client isolation |
| Grant bypass after revocation | Broker re-checks grants on every call | Cached child modules are not ambient authority |
| Host crash from child fatal signal | Child death is reported; host process continues | Failed handshake leaves no live child |

## Why child process (not isolate / container-only)

1. **Node SSR support surface:** OR3's supported self-host path is Node/Bun
   with Nitro. `worker_threads` / `vm` share the host process address space and
   do not reliably enforce fs/env/network denials without a second enforcement
   layer.
2. **Enforceable budgets:** OS-level kill of a child gives a clear termination
   story for wall/memory breaches that matches R8.AC3 ("terminates only the
   offending plugin request/runtime").
3. **Measured prototype expectation:** spawn → JSON-RPC handshake → health ping
   → SIGTERM teardown must complete in well under one second on CI runners, and
   adversarial fixtures must prove deny-by-default fs/env/network before the
   milestone is considered shipped.
4. **Containers remain optional hardening:** operators may still wrap the whole
   OR3 instance in a container; that is defense-in-depth, not the plugin
   trust-class boundary.

## Non-claims

- Trusted-host grants are **not** a sandbox.
- Cached client bytes are **not** revocable after execution.
- Isolation disabled (`pluginIsolationEnabled=false`) blocks isolated
  descriptors before import; it never silently downgrades them to trusted-host.
