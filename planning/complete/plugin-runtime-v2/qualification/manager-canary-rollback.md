# Milestones 2–3 manager-canary rollback

## Scope

The manager canary changes lifecycle coordination only for startup-selected workspaces and continues to use the frozen `BundledV1Loader` plus the V1 compatibility scope. Rollback disables manager construction and restores the existing workspace loader as the sole authority. It does not disable plugins, change workspace settings, remove packages, or select the future module loader.

## Operator procedure

1. Set `OR3_PLUGIN_RUNTIME_V2_ENABLED=false` in the process environment.
2. Restart OR3 before any non-core plugin executes. Never switch a runtime kernel live.
3. Confirm the Runtime Inspector reports `V2 startup selector: disabled`.
4. Exercise the maintained V1 plugin corpus and confirm each plugin imports and registers once with no duplicated contributions or callbacks.
5. Run `bun run plugin-runtime:milestone-2-3:qualify`. Keep V2 disabled if any manager rollback, public contract, production build, behavior, or benchmark gate fails.

To restore the canary, set `OR3_PLUGIN_RUNTIME_V2_ENABLED=true`, optionally set the comma-separated `OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS` allowlist, and restart.

## Automated evidence

`manager-canary-rollback.test.ts` proves flag-off does not invoke the manager factory and preserves the exact V1 import/register authority trace. The manager adversarial gate covers stale fetch/import/register/stop boundaries, cleanup throw/reject/hang, disable races, workspace changes, extension-over-builtin precedence, transient manifest failures, retry, and descriptor-keyed quarantine. The final gate embeds the complete frozen Milestone 0 qualification.
