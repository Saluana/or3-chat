# Milestone qualification

Run the complete Milestone 0 gate with:

```sh
bun run plugin-runtime:milestone-0:qualify
```

The command executes the declaration, unchanged plugin corpus, frozen behavior, SSR/static production build, and runner-locked benchmark gates. It always publishes a versioned result under `.output/plugin-runtime/qualification/`; failed results identify the first failed command and later gates as skipped.

`bun run plugin-runtime:milestone-0:record` writes the same result to `results/milestone-0-v1.json`. Recording is only for reviewed qualification evidence; routine runs must not rewrite the committed baseline.
