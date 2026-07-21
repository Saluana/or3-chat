# Milestone 9 rollback drill

## Purpose

Prove operators can recover from the manager default promotion without the plugin UI.

## Preconditions

- The manager production default is **true**.
- Hook runtime, module loader, and isolation production defaults remain **false**.

## Drill steps

1. **Baseline:** Run `bun run scripts/plugin-runtime/check-milestone-9-defaults.ts` — it must prove only the manager defaults on.
2. **Canary:** Set `OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS` to a non-production workspace; restart; confirm only that workspace selects the manager.
3. **Rollback flag:** Set `OR3_PLUGIN_RUNTIME_V2_ENABLED=false` outside the plugin UI; restart before discovery; confirm the V1 authority path is restored.
4. **Safe mode:** Set `OR3_DISABLE_NON_CORE_PLUGINS=true`; restart; confirm non-core plugins do not import; Inspector Safe mode: enabled.
5. **Quarantine clear (manager selected):** Use Runtime controls Retry / Clear quarantine for a descriptor key; confirm `BundledV1PluginManager.retry` path schedules reconcile.
6. **Package pointer:** If a candidate/previous pointer exists in a lab store, run promotion rollback with state preflight; confirm blocked cases leave current pointer unchanged and never claim incompatible state restore.
7. **Data retention:** After disable, confirm digests/settings remain until a distinct deletion/GC call.

## Pass criteria

- Defaults-check gate green.
- `manager-canary-rollback.test.ts` proves flag-off startup restores the exact V1 import/register authority and does not construct the manager.
- Flag-off restart restores prior manager selection for new lifetimes.
- Safe mode blocks non-core discovery.
- Hook runtime, module loader, and isolation remain default-off.

## Known lifecycle limitations (record in qualification report)

- Trusted-host grants are not a sandbox.
- Activation is not fleet-atomic.
- Disable retains packages and host-managed data.
