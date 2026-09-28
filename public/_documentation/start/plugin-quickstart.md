# Plugin quick start

For a new installable plugin, follow the [Plugin authoring guide](/plugins/plugin-development-v2). It covers the single Manifest V2 and `defineOr3Plugin()` contract for portable and trusted-host packages, local development, grant review, packaging, installation, and publication.

From an OR3 Chat source checkout, the fastest portable starter is:

```sh
bun run dev:plugin --create /absolute/path/to/my-plugin --id or3.my-plugin
```

The command opens a local host and prints its sign-in details. Edit the generated package and use `bun run dev` inside it on later sessions. See the authoring guide for validation and release steps.

Direct changes to the OR3 Chat source tree, including Nuxt `.client.ts` plugins in `app/plugins/`, are application development rather than installable plugin authoring. See [Development Setup](/start/development-setup). Existing V1 packages remain supported through a [compatibility adapter](/plugins/v1-support-and-migration), with migration guidance there.
