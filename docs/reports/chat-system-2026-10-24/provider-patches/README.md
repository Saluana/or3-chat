# Provider source repairs

These patches preserve the external provider worktree edits for findings 08, 14, 20 and 30. They include regression tests and Convex generated backend/template artifacts. They have not been published, installed or deployed.

- `sqlite.patch`: base `570ada7070df5907629a9dc1826e6edb98a54f11`; SHA-256 `660eeda21b30809cfc9975eaf2e2994c9d06eabaeb6919c964936ed93c4124fd`; 26,915 bytes.
- `convex.patch`: base `2465218c2d308aa47c62e9213983458b6b48db4d`; SHA-256 `1b3bd5c3b3f9598bbf465319bf67290acdca559ef0f71dea0dda31e2a8aed9c0`; 222,518 bytes.

Apply each patch to a clean checkout of its named provider at the exact base revision, then run that provider's checks and documented release workflow. `git apply --check <patch>` validates application without writing; `git apply <patch>` applies it. Reverse checks passed against both repaired worktrees. Do not apply a provider patch to the host repository.

The host changes remain in the managed `codex/chat-hardening` worktree. SQLite's pinned host provenance was preserved. The SQLite provider full suite passed 260 tests with 11 skips; Convex passed 309 tests. Both standalone type checks and module builds passed; SQLite lint, Convex template packing, release-contract and canonical-history checks passed. See the parent report for the full host qualification and activation limits.
