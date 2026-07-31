# Testing custom pane apps

Custom pane apps should use the same risk-based test lanes as the rest of
OR3 Chat. Prefer a small behavioral test around the public pane API over source
text assertions or large mocked integration shells.

## What to test

- Registration, replacement, and disposal through the public pane registry.
- Activation and page-switch behavior observable by a user.
- Access checks and failure states that can lose or expose user data.
- One responsive browser journey when layout behavior cannot be established
  with a component test.

Do not copy the registry implementation into a test, assert exact CSS strings,
or leave a suite permanently skipped. Delete obsolete cases and add a focused
production-backed test when the behavior is still supported.

## Test lanes

```bash
# Everyday production-backed unit and component tests
bun run test

# Tests related to current Git changes
bun run test:changed

# Real multi-module and IndexedDB integrations
bun run test:integration

# Frozen V1/V2 plugin compatibility contracts
bun run test:plugin-compatibility

# Script, deployment-policy, and release checks
bun run test:scripts
bun run test:release-policy

# Every non-live Vitest lane
bun run test:full
```

Live network and browser tests are always explicit:

```bash
bun run test:live
bun run test:e2e:command-palette
bun run test:e2e:storage
bun run test:e2e:admin-auth
bun run test:e2e:journeys
bun run test:e2e:visual
bun run test:e2e:cloud:stress
```

Never use a broad browser run for a test that writes credentials, calls a paid
API, records visual artifacts, or exercises stress/performance behavior. Such
tests must require their named harness and use isolated data.

## Authoring rules

1. Import production behavior. A test-local `Map`, state machine, sanitizer, or
   fake provider does not prove the corresponding OR3 implementation.
2. Keep one behavior in one canonical suite. Reuse table-driven contracts for
   registry families and provider adapters.
3. Use tiny fixtures. Set a fake file's `size` instead of allocating tens of
   megabytes; use fake timers instead of fixed sleeps.
4. Run the narrowest affected test while editing. Use `test:full` only for
   cross-cutting, high-risk, or release work.
5. A skipped test must have a short-lived external reason. Otherwise fix it,
   move it to an explicit lane, or delete it.

## CI policy

The core lane is the pull-request feedback gate. The full non-live suite runs
on the scheduled/manual workflow so integration, compatibility, and release
coverage remain enforced without taxing every local edit.
