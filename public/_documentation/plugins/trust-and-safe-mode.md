# Trust Model and Safe Mode

## Trust classes

- **trusted-host** — host JS realm with reviewed grants. **Not a sandbox.**
- **isolated-client** — iframe or worker + grant-checked RPC.
- **isolated-server** — isolated server runtime + grant-checked RPC.

Isolation never silently falls back to trusted-host. With isolation disabled, isolated descriptors are blocked before import.

## State rollback

Package pointer rollback runs on the server promotion service and is gated by state preflight. A successful code rollback does not claim incompatible migrated state was restored. Disable, uninstall, GC, and data deletion remain separate.

## Safe-mode runbook

1. Set `OR3_DISABLE_NON_CORE_PLUGINS=true` outside the plugin UI.
2. Restart before plugin discovery.
3. Confirm Runtime Inspector → Safe mode: enabled.
4. Use Runtime controls for retry/quarantine clear when the V2 manager is selected.
5. Keep V2 feature flags off unless executing a reviewed promotion.

See also planning docs under `planning/plugin-runtime-v2/trust-model-and-safe-mode.md`.
