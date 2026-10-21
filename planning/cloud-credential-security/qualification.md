# Qualification receipt

## Scope

Reviewed fetched defaults: Chat `or3-cloud` at `c302859545cff5fa5794825adbe77b6dbac6ce8f`, Secrets `main` at `5be25045eea086593ac539a0cd7e6963bd150a97`. Implementation is isolated in `codex/cloud-credential-security`. The existing published `@or3/secrets@0.1.1` protocol/client/CLI suffices; no Secrets source or immutable package version was changed.

All service credentials and account keys used below are disposable synthetic fixtures. No production vault, credentials, deployment, publication or paid inference was used. Delivery: [draft PR #270](https://github.com/Saluana/or3-chat/pull/270), implementation commit `5d982c91`.

## Executed checks

| Check | Actual result |
| --- | --- |
| Affected Vitest suites: account policy/OAuth, stream, jobs, capability admission, plugin secrets/workflows, broker, browser migration/logout, continuation, autocomplete, context admission, deadlines and provider selection | 24 files; 485 passed, 1 skipped |
| Additional auth, memory API and Cloud export regressions | 7 files; 115 passed |
| Nuxt launcher subprocess suite | 33 passed; build excludes vault, preview preserves selection |
| Cloud CLI `bun test test` | 7 files; 247 passed, 4 skipped, 0 failed |
| Secrets `bun test --timeout 30000 tests` | 28 passed, 0 failed, 327 assertions |
| App `bun run type-check` | Passed with disposable Basic Auth + SQLite + filesystem configuration |
| Cloud CLI typecheck/build; Secrets typecheck/build | Passed |
| App production build | Passed with disposable provider paths/configuration |
| Native `linux/arm64` production Docker build | Passed with the fixed profile before the final help-chat guard/build-launcher consolidation; final Docker rerun awaits local engine recovery |
| Existing static OpenRouter browser suite | 4 passed |
| `bun run check:docs` | Passed: 115 files, 103 mapped routes, 20 typechecked examples |
| `git diff --check` | Passed |

Real-service checks are repeatable from the Chat root:

```sh
bun scripts/test/run-cloud-vault-e2e.ts
bun scripts/test/run-cloud-credentials-e2e.ts
# Requires the locally built production image:
bun scripts/test/run-cloud-vault-lifecycle-e2e.ts
```

The first script passed all six phases: fresh initialization; separate UID/mount custody; scoped record separation and operator-token denial; crash restart/token rotation; outage; encrypted stopped backup/fresh-key recovery; durable deletion; missing-key refusal. The script emits `test-results/cloud-vault/receipt.json` and removes its uniquely named containers/volumes.

The browser script uses the real Unix service, installed providers, Basic Auth, SQLite and filesystem storage. It verifies account binding, owner-tagged import, no browser hydration, cross-device connection/deletion, tombstone rejection, the documentation help-chat guard and browser-header bypass refusal. The clean final run passed (one browser scenario). Its receipt, screenshot and Playwright artifacts are under `test-results/cloud-credentials/`.

The lifecycle script uses the actual published `@or3/cloud@0.1.90` and published GHCR image as its baseline, then a temporary **local-only** candidate version `0.1.91` to exercise the managed updater. Repository versions stay `0.1.90`. It checks upgrade, outage/restart, checksummed encrypted backup, managed restart/persistence, rollback, fresh initialization and explicit disablement. Earlier runs passed published-release update, outage/restart, checksummed backup, managed restart/persistence, rollback and fresh initialization. The explicit-disable case initially used Compose restart, which retains the old environment; the harness now applies the setting with stop/start. The final rerun was interrupted during baseline startup when the local Docker engine stopped responding. The user explicitly chose to leave Docker alone. The corrected explicit-disable case and final Docker rerun remain blocked and unqualified; interrupted-fixture cleanup is unverified. No Docker recovery or cleanup is being attempted, and this decision does not waive the remaining release or production qualification gates. Any later cleanup must first verify the fixture's Compose working-directory labels. Its receipt is under `test-results/cloud-vault-lifecycle/`.

## Review and negative controls

- Billing matrix covers required BYOK (including override disabled), optional user override, instance-only, absent keys, disabled provider and provider outage. A selected outage cannot silently switch billing to the instance. Cloud never consumes browser key headers.
- Real browser negative control reproduced importing into the current cookie account without matching the tab's expected account; the route now rejects missing/mismatched account bindings before storage. Tests also reproduced the non-concrete default provider; selection no longer mutates frozen Nitro config. The final built Nitro output was inspected and retains `or3-secrets` as its runtime default even though the build subprocess disables access during prerender.
- Existing secret route/capability suites retain sealed activation, approved grants, selected package, user/workspace and revocation checks. No new grant framework or shared-secret lookup was introduced.
- Raw credentials remain in server-only resolution/execution. OAuth uses a fixed destination, account-bound PKCE and sanitized status redirects. Credential-bearing fetches refuse redirects. Browser status/session payloads contain no raw key.
- Simplification retained the published vault protocol, existing registry, account/workspace authorization, billing settings, plugin admission and backup machinery. No new dependency, application table, general proxy, or permission layer.
- Initial sandbox-denied socket/HTTP checks were rerun with local IPC access and passed. Unconfigured Clerk defaults were replaced with the fixed disposable profile for the final typecheck. The disablement harness was corrected to use stop/start: Compose restart deliberately retains the old container environment.

## Explicit limits

- This is code/integration qualification, **not independent production qualification**. Runtime advisory review, independent security review, target-host power-loss/durability and measured recovery objectives remain production blockers. No FIPS or dual-architecture scan qualification is claimed.
- No live OpenRouter OAuth/account or paid upstream inference was exercised. OAuth exchange and billing headers are covered with synthetic upstreams; the vault and deployment lifecycles are real.
- Cloud browser `ai.provider()` is intentionally unsupported because its contract returns a raw key. Legacy plugins using that SDK path, including workflow image/caption adapters, must migrate to compatible host operations/completion. Static SDK behavior remains. Approved trusted server workflow adapters retain privileged server-only raw-key compatibility and live-origin checks; arbitrary trusted code is not isolated.
- Portable private-secret APIs remain unsupported as before. Reviewed trusted plugins retain private-secret access through existing scopes/grants; no platform credential lookup is exposed.
- Automatic custody supports one persistent managed Docker host. Other stateful deployments must provision the provider securely. Stateless or independent multi-host deployments require a suitable replacement or explicit instance-only opt-out; no replication is implemented.
- Offline/inaccessible browser copies cannot be erased remotely. Unowned legacy values require re-entry. New Cloud code never reuses them for inference.
- Application rollback preserves the live vault and revocations. Disaster recovery is an explicit fresh-key restore into new custody, with separately protected master-key recovery material; the managed app backup deliberately excludes that key.

The complete repository-wide test suite and full release/publish gate were not run: this PR neither consumes a release version nor deploys production. Relevant checks above and repeatable local service evidence define the present validation boundary.
