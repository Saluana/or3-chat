# Plugin Runtime benchmark baseline

`budgets.json` is the reviewed workload matrix and regression policy. `milestone-0-v1.json` is the first measured V1 baseline, recorded in its production qualification context after the SSR/static build gates. The benchmark checker hashes the policy into the baseline and refuses to compare results when either the policy or selected runner differs.

Run the gate on the selected runner with:

```sh
bun run plugin-runtime:benchmarks:check
```

Use `bun run plugin-runtime:benchmarks` for an uncommitted report. `bun run plugin-runtime:benchmarks:record` rewrites the baseline and is reserved for an intentional, reviewed budget adjustment. A record produced on a different CPU, OS, architecture, or runtime is not comparable and must use a separately reviewed runner baseline.

The `diagnostics.long-session` observations describe V1 retention; they are not V2 capacity targets. Later immutable diagnostics must retain their committed caps while the mutable V1 `_diagnostics` facade remains compatible.
