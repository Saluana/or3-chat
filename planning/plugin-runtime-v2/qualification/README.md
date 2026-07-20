# Milestone qualification

Run the complete Milestone 0 gate with:

```sh
bun run plugin-runtime:milestone-0:qualify
```

The command executes the declaration, unchanged plugin corpus, frozen behavior, SSR/static production build, and runner-locked benchmark gates. It always publishes a versioned result under `.output/plugin-runtime/qualification/`; failed results identify the first failed command and later gates as skipped.

`bun run plugin-runtime:milestone-0:record` writes the same result to `results/milestone-0-v1.json`. Recording is only for reviewed qualification evidence; routine runs must not rewrite the committed baseline.

Run the Milestone 1 descriptor/shadow gates and observer-only rollback drill with:

```sh
bun run plugin-runtime:milestone-1:qualify
```

The final Milestone 1 gate invokes the complete Milestone 0 qualification. The operator procedure and exact rollback boundary are documented in [shadow-rollback.md](./shadow-rollback.md). Use `plugin-runtime:milestone-1:record` only to publish reviewed evidence under `results/milestone-1-shadow-v1.json`.

Run the Milestones 2–3 lifecycle/manager gates and manager-only rollback drill with:

```sh
bun run plugin-runtime:milestone-2-3:qualify
```

The final gate invokes the complete Milestone 0 qualification. The exact startup-only rollback boundary is documented in [manager-canary-rollback.md](./manager-canary-rollback.md). Use `plugin-runtime:milestone-2-3:record` only to publish reviewed evidence under `results/milestone-2-3-manager-v1.json`.

Run the Milestone 4 atomic contribution, leak, and per-surface rollback gates with:

```sh
bun run plugin-runtime:milestone-4:qualify
```

The final gate invokes the complete Milestone 0 qualification. The qualification manifest records the startup-only, one-surface rollback boundary. Use `plugin-runtime:milestone-4:record` only to publish reviewed evidence under `results/milestone-4-contributions-v1.json`.
