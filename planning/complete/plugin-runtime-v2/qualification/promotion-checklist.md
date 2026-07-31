# Default-promotion record (tasks 9.10 / 9.11)

## 9.10 Manager default promotion

**Decision:** promoted. `pluginRuntimeV2Enabled` now defaults to `true`.
`hookEngineV2Enabled`, `pluginModuleLoaderV2Enabled`, isolation, and all
contribution surfaces remain default-off.

- [x] Milestone 9 qualification report green (`bun run plugin-runtime:milestone-9:qualify`)
- [x] Manager canary selector proves an allowlisted workspace selects V2 and a non-allowlisted workspace stays on V1
- [x] Flag-off rollback restores the exact V1 import/register authority without constructing the manager
- [x] Safe mode remains available before discovery (`OR3_DISABLE_NON_CORE_PLUGINS=true` + restart)
- [x] Default guard proves this change enables neither Hook Runtime V2 nor ModuleV2Loader

Rollback: set `OR3_PLUGIN_RUNTIME_V2_ENABLED=false` outside the plugin UI and
restart before discovery. No package, settings, or plugin data is deleted.

## 9.11 Independent release evaluations

These are release decisions, not a bundled promotion. A green component gate
does not authorize a default change; each row must later be promoted in its own
reviewed release after an operational canary. Until then, its default remains
off.

| Release | Qualification evidence | Canary result | Startup rollback | Decision |
|---|---|---|---|---|
| Hook Runtime V2 | `results/milestone-5-hooks-v1.json`; hook conformance, compatibility, benchmarks, and single-execution drill green | Startup-selection test passes for V1 and V2; no global operational canary recorded | `OR3_HOOK_ENGINE_V2_ENABLED=false` + restart before registration | **Defer** |
| Contribution surfaces | `results/milestone-4-contributions-v1.json`; every surface has differential and disposal coverage | One-surface selection test passes for every surface; no broad-default operational canary recorded | Remove only the affected id from `OR3_PLUGIN_CONTRIBUTION_V2_SURFACES` + restart | **Defer** |
| ModuleV2Loader | Module-loader/package-promotion gates; `host-esm-facade-spike.md` | Service-only paths pass, but trusted-host UI remains `rebuild-required` because the production host-facade proof is blocked | `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED=false` + restart; bundled V1 remains | **Defer / blocked for trusted UI** |
| Isolation | `isolated-server-threat-model.md`; client/server isolation suites | Isolation enable/disable tests pass; no production tenant canary recorded | `OR3_PLUGIN_ISOLATION_ENABLED=false` + restart; isolated descriptors block rather than downgrade | **Defer** |

The canary column deliberately distinguishes deterministic qualification from
an operational deployment. Missing operational canary evidence is a no-go
result, never an implied pass.

## Template for a later promotion PR

```md
## Summary
- Promote <one flag or surface family> default from off to on after qualification <version>.
- Does not enable: <all other independently controlled releases>.

## Evidence
- Qualification artifact: planning/plugin-runtime-v2/qualification/results/<file>.json
- Operational canary: <workspace / environment / build / result>
- Rollback drill: <startup flag or one-surface removal, date, result>

## Test plan
- [ ] Fresh process with the promoted default loads expected plugins only
- [ ] Explicit rollback value + restart restores prior behavior without data deletion
- [ ] Runtime Inspector labels trust and safe-mode correctly
- [ ] No silent isolated-to-trusted-host fallback
```
