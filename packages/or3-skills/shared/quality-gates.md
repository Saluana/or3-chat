# Quality gates

Follow the target checkout's `AGENTS.md` test lanes and inspect the final diff.
Choose checks that exercise the changed contract rather than widening scope by default.

| Surface | Relevant evidence | Typical checkout commands |
| --- | --- | --- |
| Setup | Config validation and relevant health checks | `bun run or3-cloud:validate`; `bun run doctor` |
| Source plugin/core | Canonical behavior checks and changed public types | Targeted suite; `bun run type-check` when relevant |
| SDK package | Manifest/grants, SDK imports, tests, built archive | Current `plugin-runtime:cli` validate/test/build/pack/inspect operations |
| Theme | Schema and affected visual/interaction states | `bun run theme:validate`; `bun run theme:build-css` for selector CSS |

Use named harnesses for paid-network, credential-writing, stress, performance, or visual-artifact suites.
A missing or changed command is a compatibility finding; inspect its supported replacement rather than inventing a successful check.
Successful packaging alone does not prove installation, activation, or isolation.
