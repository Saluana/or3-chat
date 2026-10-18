# OR3 Skills

Task-oriented guidance for safely setting up and extending OR3 Chat.

- `or3-setup`: supported installation, configuration, and repair.
- `or3-plugin-development`: source contributions and installable SDK packages.
- `or3-theme-development`: theme and supported visual changes.
- `or3-core-development`: core defects and missing public contracts.
- `or3-openclaw-setup`: OpenClaw's OR3 Runs integration.
- `or3-hermes-setup`: Hermes's built-in Runs server.

Skills use the target checkout's `AGENTS.md`, docmap, current types, and documentation.
Shared references cover routing, safety, validation, and concise completion evidence.

## Package checks

```sh
bun run validate
bun run context --cwd ../..
bun run check:drift --cwd ../..
bun run eval
bun run test:all
```

`check:drift` reports changed paths/contracts for review.
`eval` validates the fixture corpus and does not run or score a model.

## Runtime boundary

Current OR3 hosts support reviewed trusted-host clients/server routes and contained portable `isolated-client` packages.
Activation still depends on package verification, grants, browser qualification, and workspace enablement; `isolated-server` is not a supported production installation mode.
Consult the target checkout's plugin docs and SDK support table before claiming a capability, installation, or activation.

See [architecture](./architecture.md), [design](./design.md), and the [implementation record](./tasks.md).
