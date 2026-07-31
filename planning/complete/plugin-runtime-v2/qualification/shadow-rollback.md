# Milestone 1 shadow-observer rollback

## Scope

The Milestone 1 manager is a read-only browser observer. V1 remains authoritative for discovery, imports, registration, cleanup, and workspace reconciliation. This rollback removes only observer construction and diagnostics; it does not disable plugins, rewrite plugin settings, or change installed packages.

## Operator procedure

1. Set `OR3_PLUGIN_RUNTIME_SHADOW_ENABLED=false` in the process environment.
2. Restart the OR3 process. Runtime flags are intentionally startup-only after plugin code may have executed.
3. Confirm the Runtime Inspector says `Manager: V1 only (observer disabled)`.
4. Exercise the maintained V1 plugin corpus. Plugin loading and cleanup remain available; shadow records and divergences remain empty because the observer is not instantiated.
5. Run `bun run plugin-runtime:milestone-1:qualify`. The rollback drill proves no resolver/manager dependency is constructed and then runs the complete frozen Milestone 0 qualification.

To restore observation, set `OR3_PLUGIN_RUNTIME_SHADOW_ENABLED=true` (or remove the override) and restart. If disabling only the observer does not restore the V1 behavior baseline, keep it disabled and treat the candidate release as unqualified.

## Automated evidence

`app/composables/plugins/__tests__/shadow-rollback.test.ts` records the authoritative trace as exactly one V1 import followed by exactly one V1 registration while the observer factory returns `null`. It also asserts that neither descriptor-resolver nor shadow-manager construction occurs. The Milestone 1 qualification embeds the full Milestone 0 declaration, external corpus, behavior, SSR/static production-build, and benchmark gates.

