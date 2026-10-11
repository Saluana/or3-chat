# Publication CI repair for draft PR #240

Initial published/qualified source: `352e11b87b9873578a5f16160b131d99fad26eab`.
Original base: `df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5`.
Publication was subsequently authorized, followed by authorization to repair
the two verified CI failures in a separate commit. No merge/deployment or Mac
access is authorized for this executor. Mac combined verification is separate.

## Confirmed failures and narrow repair

[Checks run 38150903708](https://github.com/Saluana/or3-chat/actions/runs/38150903708)
failed before application typecheck/core tests:

- Core changed-file lint rejected all eight audit TypeScript runners because
  none belonged to a configured parser project. Local replay confirms the same
  eight parser errors. `tsconfig.eslint.audit.json` now supplies a scoped project
  for audit runners, with existing typed rules unchanged. No new ignore or rule
  suppression was added. Bun definitions are pinned at `bun-types@1.3.14` as a
  development dependency; contributor and fixed-profile locks include them.
- Compatibility validation rejected a stale ledger. The supported
  `bun run plugin-runtime:ledger` regeneration updates only four declaration
  positions in `useDefaultPrompt.ts` and their containing composables module's
  derived API hash. Module count, exports, callable signatures, runtime/public
  paths, behavior profiles and Nuxt imports are unchanged. Public API/Nuxt
  declaration snapshots remain byte-identical and were not regenerated.

Typed coverage also exposed unsafe assignments in the two local browser
harnesses. Their dynamic imports now refer to the actual module types; shared
fixture state, the mounted Vue/Nuxt host and synthetic JSON receipts are typed.
The existing rules remain enabled. `verify-ci-repair.ts` checks that both edited
harnesses preserve every emitted JavaScript token relative to the initial
published HEAD. Application/server/shared/SDK runtime source is untouched.

The fixed-profile lock adds only the pinned development type package and
the root development dependency. It reuses its existing compatible Node types;
existing package entries and production dependencies remain unchanged. Bun's
contributor lock separately resolves the type package's Node/Undici dependency.
No application dependency upgrade, wire schema, preference or provider change.

An initial candidate using the auto-discovered `@types/bun` facade altered
Vite HMR typing in the documentation example checker. That candidate was
withdrawn; `bun-types` is explicitly selected only by the audit lint project,
preserving application and documentation type environments.

The source development guide/docmap now explain typed audit lint coverage and
reviewed ledger regeneration. Configuration is the appropriate surface for
these CI failures; no core runtime API or caller behavior changes are needed.

## Reproducible qualification

Use Bun 1.3.14 and the repository's synthetic disabled-provider typecheck
environment. Final command/commit/status receipts are `ci-repair-final-*-runner.txt`
in this evidence directory; they are local outputs rather than another source
commit that would invalidate their exact-HEAD identification.

- `bun audit-evidence/workspace-isolation-20261011/verify-ci-repair.ts`: checks
  runtime token identity, ledger contract identity and runtime-source scope;
  proves a temporary unsafe audit assignment is rejected by the existing lint
  error rule and a typed control passes. Both temporary fixtures are removed.
- The exact CI `bun run lint:changed -- <all changed JS/TS/Vue files>` invocation
  is recorded with its complete argument list, including every audit runner.
- `bun run plugin-runtime:compatibility:check`: generated ledger and frozen
  public API/Nuxt import snapshots.
- `bun run test:plugin-compatibility --maxWorkers=2`: 176 tests / 30 files at the
  repair candidate; final exact-HEAD receipt confirms qualification.
- `bun x vitest run --project=scripts scripts/__tests__/plugin-runtime-compatibility-snapshots.test.ts --reporter=dot --silent=passed-only --maxWorkers=2`:
  four tests, including removed-import and changed-return rejection controls.
- `bun run plugin-runtime:examples:check` and
  `bun run plugin-runtime:external-v1:check`: compatibility fixture compilation.
- `bun install --frozen-lockfile --ignore-scripts`, `bun run check:lock-drift`,
  `bun run check:docs`, `git diff --check`, and full `bun run type-check`.

The original 830 isolation tests and six targeted Chromium cases qualified the
initial published source. This repair preserves runtime source and harness JS;
it does not claim a new browser or combined Mac qualification. Historical
candidate receipts retain the original parser/ledger failures, typed-lint
cleanup, and corrected verification-fixture setup attempts.

## Rollback and remaining limits

Revert the separate publication-CI repair commit to restore the initial draft
source checkpoint. No data migration or cleanup is required. This restores the
known CI parser/ledger failures. Original isolation rollback remains in README.

Actual CI status is reported after publishing the new HEAD; local checks do not
substitute for a successful GitHub run. Docker image builds, paid providers,
production access and multi-replica behavior are not qualified by this repair.
