# Coordinated sibling package changes

Both sibling directories have been edited directly. They are outside the host Git repository, so this PR also includes their source patches. Generated bundles and installed dependencies are excluded; rebuild them from the patched source.

Each patch is relative to its own package root. Apply to the original 0.1.1 directory, **not** to the already edited local directory:

```sh
cd ../or3-plugin-external-agents
git apply --check ../or3-chat/planning/plugin-host-bridge-retirement/package-patches/or3-plugin-external-agents.patch
git apply ../or3-chat/planning/plugin-host-bridge-retirement/package-patches/or3-plugin-external-agents.patch
cd ../or3-plugin-workflows
git apply --check ../or3-chat/planning/plugin-host-bridge-retirement/package-patches/or3-plugin-workflows.patch
git apply ../or3-chat/planning/plugin-host-bridge-retirement/package-patches/or3-plugin-workflows.patch
```

`git apply` also works in a directory without a Git repository. `source-receipt.json` records patch digests and original file hashes to identify the exact input. The host checkout must contain SDK 2.1.0 before installing these packages' local development dependencies. Production package manifests require the public SDK API floor and the advertised trusted features; they do not use sibling aliases at runtime.

Validate External Agents with `bun run test`, `bun run typecheck` and `bun node_modules/@or3/plugin-sdk/bin/or3-plugin.mjs validate .`. Validate Workflows with `bun run test:routes`, `bun run test:continuity`, `bun run typecheck` and `bun run validate`. Build and pack both with the SDK CLI.
