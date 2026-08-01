# OR3 Skills

Portable, task-oriented guidance for safely setting up and extending OR3 Chat.
The package is developed in this repository, but its skills avoid private host
imports and can be extracted without changing their layout.

## Included skills

- `or3-setup` — configure a supported local or cloud-backed OR3 installation.
- `or3-plugin-development` — build, test, and package V1 or V2 plugins.
- `or3-theme-development` — change visual surfaces through the theme system.
- `or3-core-development` — add a public extension contract only when no supported surface fits.

Each skill starts from the checkout's `AGENTS.md` and
`public/_documentation/docmap.json`, then loads only the documentation needed
for the request. The shared material defines routing, quality gates, permission
disclosure, and a consistent completion report.

## Commands

From this directory:

```sh
bun run validate
bun run context --cwd ../..
bun run check:drift --cwd ../..
bun run eval
bun run test:all
```

`check:drift` validates paths and commands against a local OR3 Chat checkout;
it intentionally fails instead of treating a changed public contract as current.
`eval` checks the fixture corpus only. It does not claim to run or score a
model until an agent adapter is deliberately added.

## Important runtime boundary

Plugin Runtime V2 has an SDK, validation, packing, inspection, storage, and
promotion primitives. The normal production workspace does not yet activate a
V2 package end-to-end. A V2 skill run may produce a validated artifact, but it
must not claim that it installed or activated it unless the target checkout
demonstrates that path.

See [architecture.md](./architecture.md), [design.md](./design.md), and
[tasks.md](./tasks.md) for the V1 implementation record.
