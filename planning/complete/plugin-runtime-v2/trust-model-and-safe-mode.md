# Trust model, state rollback rules, and safe-mode operator runbook

## Trust model

| Trust / isolation | Meaning | Operator label |
|---|---|---|
| `trusted-host` | Runs in the host realm with reviewed grants | **Not a sandbox** |
| `isolated-client` (`iframe` / `worker`) | Client code reaches host only via schema-validated, grant-checked RPC | Sandboxed client |
| `isolated-server` | Server handlers run in the isolated server runtime with grant RPC | Sandboxed server |

Silent fallback from isolated → trusted-host is prohibited. When `pluginIsolationEnabled` is off, isolated descriptors are blocked before import; trusted plugins continue.

## State rollback rules

1. Package pointer rollback is a **server** promotion operation (`PluginPackagePromotionService.rollback`).
2. Preflight (`preflightPluginStateCompatibility`) must allow the operation; otherwise the current pointer is left unchanged.
3. `rollback: "safe"` means prior state bytes remain readable; `"migration-required"` / `"unsupported"` block claiming a clean code+state rollback.
4. Disable, uninstall (pointer clear), digest GC, and data deletion are **separate** controls. Disable retains packages and host-managed settings/data.

## Safe-mode operator runbook (no plugin UI)

Use when a plugin generation is wedged, quarantined repeatedly, or you need a known-good process lifetime.

1. Set `OR3_DISABLE_NON_CORE_PLUGINS=true` (maps to `admin.disableNonCorePlugins`) **outside** the plugin admin UI (env / process manager).
2. Restart the OR3 process **before** plugin discovery so non-core plugins never import.
3. Confirm Runtime Inspector shows **Safe mode: enabled** on the recovered client.
4. Optionally clear per-descriptor quarantine via Runtime controls **Retry** / **Clear quarantine** once the V2 manager is selected and the process is healthy again.
5. For persisted package issues, use server lifecycle/promotion APIs (or CLI inspect + pointer ops), not client shadow status alone.
6. Keep V2 startup flags unchanged unless you are executing a reviewed promotion/rollback drill:
   - `OR3_PLUGIN_RUNTIME_V2_ENABLED`
   - `OR3_HOOK_ENGINE_V2_ENABLED`
   - `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED`
   - `OR3_PLUGIN_ISOLATION_ENABLED`

### Explicit limitations

- Safe mode is **startup-only** for a process lifetime.
- Activation is **not fleet-atomic**.
- Trusted-host grants are **not** a sandbox.
- Disable retains digests and data until explicit deletion.
