# Plugin authoring guide

Installable plugins use one authoring contract: `defineOr3Plugin()` from
`@or3/plugin-sdk`, a Manifest V2 `or3.manifest.json`, and the candidate →
canary → promote → workspace-enable lifecycle. Choose `isolated-client` for a
portable, mediated UI or `trusted-host` when the feature needs reviewed Vue,
chat, pane, hook, activity, or server-route access. Trusted code runs in the
host page; isolation never silently changes when a capability is unavailable.

| Runtime | Starting point | Host boundary |
| --- | --- | --- |
| Portable isolated client | `bun run dev:plugin --create` (default `portable-v1` profile) | Mediated SDK capabilities in a worker |
| Trusted host | `or3-plugin create --template minimal-v2`, or the Workflows and External Agents packages | Reviewed grants, host ABI, and explicit host-owned integrations |

The portable path below covers live editing and marketplace submission. The
trusted-host path follows it. Both use the same manifest and review lifecycle.
Older V1 packages remain a compatibility format, with [migration
notes](./v1-support-and-migration); they are not a second authoring path.

You need Bun 1.3.6 or newer, an OR3 Chat source checkout with dependencies
installed, its sibling `or3-provider-basic-auth` source checkout, and a
marketplace account to submit. The SDK is not yet on npm;
the host packs and installs it locally for the starter. Choose a plugin ID
under the namespace of the developer profile you will use for submission;
`ada-tools.example` below is a placeholder.

## Portable path: create and run the plugin

Replace the path and ID before running this command from the host checkout:

```sh
cd <path-to-or3-chat>
bun run dev:plugin --create /absolute/path/to/example --id ada-tools.example
```

The command creates and installs the portable starter, then opens its isolated
local host. Open the printed URL if necessary, sign in once with the printed
password, and review the requested permissions. Edit `client.mjs` and save:
the page builds, checks and runs that edit in the real plugin worker without a
reload or file upload. Build errors keep the previous package running. New
permissions require review. Saved settings and storage survive replacement;
in-memory worker state restarts. Stop the host with Ctrl+C when finished. In
later sessions, start it from the plugin directory with `bun run dev`.

Edit `.authoring/profile.config.mjs` for your plugin; watched development runs
`profile:generate` for you. Keep generated descriptors and `bun.lock` in source
control. See the [portable profile](./portable-profile) for supported
capabilities, [local development](./local-development) for recovery, and the
[SDK CLI reference](./plugin-sdk-cli) for manual scaffolding.

## Check the package and freeze a candidate

Run these from `example/` after editing the plugin:

```sh
bun run profile:check
./node_modules/.bin/or3-plugin validate .
./node_modules/.bin/or3-plugin test .
./node_modules/.bin/or3-plugin build .
./node_modules/.bin/or3-plugin pack . --archive ../example.or3pkg
./node_modules/.bin/or3-plugin inspect ../example.or3pkg
```

Fix any findings and repeat the checks. A publishable candidate needs a clean
Git commit. The starter already ignores installed dependencies, build output
and its local host association. Commit the source and lockfile (or make an
equivalent clean commit in your existing repository):

```sh
git init
git add .
git commit -m "Prepare V2 plugin candidate"
```

Then freeze the candidate in a new output directory:

```sh
./node_modules/.bin/or3-plugin candidate . --out ../candidates/example-1
./node_modules/.bin/or3-plugin candidate --verify ../candidates/example-1
./node_modules/.bin/or3-plugin candidate --qualify . --candidate ../candidates/example-1
```

The candidate command builds and freezes `package.zip`, `source.zip` and
`receipt.json`. `--verify` checks their identities without rebuilding.
`--qualify` rebuilds from the frozen source and requires the exact clean source
commit, lockfile and SDK inputs. A dirty candidate can be tested locally but
cannot qualify for publication. Keep all three files together and unchanged;
after any source change, create a **new** candidate directory. The earlier
`.or3pkg` is useful for inspection but is not the submitted candidate.

## Exercise those files in OR3 Chat

To test the **exact frozen submission files**, start the manual development
instance from the OR3 Chat checkout:

```sh
bun run dev:plugin
```

Open its printed loopback URL and sign in as the owner. In
**Admin → Plugins → Development candidate**, select the candidate's
`package.zip`, `source.zip` and `receipt.json`. Review requested grants, admit
the candidate, run the canary, and promote it. Open the plugin in Chat and
exercise its first useful action, including any setup it requests. You may
export a developer verification receipt to attach to the marketplace draft.
This instance uses separate local data; the verification receipt is evidence
of your test, not marketplace approval. See [Local Development
Candidates](./local-development) for admission requirements and replacement
behavior.

The watched candidate used while editing is disposable. Only the explicit
clean, verified and qualified candidate from step 2 is submitted.

## Submit the same candidate to staging

At [the staging marketplace](https://staging.marketplace.or3.chat/developer),
sign in and create a developer profile if needed. Submission eligibility is
enabled separately by the marketplace operator; check the profile's
**Submission eligibility** before final submission. The profile namespace
must own the plugin ID.

1. Open **Developer → Submissions**. Upload the frozen `package.zip` as the
   package and `source.zip` as the source. The site creates a draft and shows
   its listing preview and checklist.
2. Complete the listing fields and address its blockers. Attach the same
   `receipt.json` to the draft, optionally with the developer verification
   receipt from local testing. A digest mismatch means the files no longer
   describe one candidate; make a new candidate rather than editing frozen
   files.
3. Select **Submit for review** when the checklist allows it. The final
   transition requires recent account verification. Staging may accept recent
   first-factor verification when its temporary exception is enabled;
   production requires MFA. Upload and draft editing do not grant submission
   eligibility.

The marketplace independently validates the exact uploaded bytes. Your
receipts are labeled developer-supplied and cannot satisfy trusted validation
or reviewer approval.

## Follow review and publication

The submission page shows who acts next:

| Status | What happens next |
| --- | --- |
| Uploaded / Validating | The marketplace runner validates the frozen files. |
| In review | A reviewer decides against the current trusted evidence and listing revision. |
| Changes requested / Rejected | Address findings and create a new submission revision with new frozen files. |
| Approved | The marketplace operator completes detached signing approval and publication. |
| Published | Read the publication receipt on the submission page. The version's bytes are immutable. |

After staging publication, a staging-configured OR3 Chat host can acquire the
signed release through Marketplace. Its registry origin and release public key
must be configured first; [Trusted Registry Acquisition](./trusted-acquisition)
explains that operator setup. Compare the installed release digests with the
publication receipt, then exercise the plugin again. Staging publication does
not publish the release to production. Releasing there needs its own review,
authorization and environment checks.

## Trusted-host path

Start with `or3-plugin create --id <id> --dir <path> --sdk-source <sdk-path> --template minimal-v2` or study the separately
built `or3-plugin-workflows` and `or3-plugin-external-agents` packages. Keep
plugin code free of OR3 app aliases (`~/`, `~~/`, `#imports`) and Nuxt
auto-imports. Import `vue` and `@or3/plugin-sdk` as host singletons; the build
bundles package-local modules and Vue components, and emits a sibling CSS file
when the client entry imports styles. The host refuses activation if its Vue
ABI/import-map proof fails; it does not bundle a second Vue as a fallback. An
existing bundled plugin can continue through the compatibility adapter while
the ABI is unavailable.

Declare `manifestVersion: 2`, `trust: "trusted-host"`,
`runtime.client: { "entry": "client.mjs", "format": "esm", "isolation": "host" }`,
and only the `requestedGrants` your plugin uses. If it owns server routes,
declare them under `runtime.server.routes` with a relative path and permission.
The host checks each grant against its qualified adapters during review; a
manifest string alone never grants access. The SDK [manifest
reference](./manifest-v2), [capability reference](./plugin-sdk), and [CLI
reference](./plugin-sdk-cli) define the contracts.

Export one definition from the client entry:

```js
import { defineOr3Plugin } from '@or3/plugin-sdk';
import manifest from './or3.manifest.json' with { type: 'json' };
import Sidebar from './src/Sidebar.vue';

export default defineOr3Plugin({
  manifest,
  setup(context) {
    const sidebar = context.ui.registerSidebar({
      id: 'example-sidebar', label: 'Example', component: Sidebar,
    });
    context.onCleanup(() => sidebar.dispose());
  },
});
```

This example needs `ui.sidebar.register`. Other reviewed contributions include
pane apps, command palette entries, chat renderers/editor extensions, hooks,
activity, storage, secrets, files, and HTTP/SSE. Use the host context for
capabilities and dispose every listener or registration with the activation.
The official feature packages also receive narrowly scoped host integrations
for existing workspace and background-job behavior; those are not general SDK
APIs for third-party packages.

Run the package's tests and typecheck, then `or3-plugin validate .`,
`or3-plugin build .`, and `or3-plugin pack . --archive <path>`. Build again
after every source edit before packing. The packed ZIP follows the same
candidate upload, grant review, browser canary, promotion, and workspace
enablement described above. Test both enabled and disabled states; disable
must remove UI contributions while leaving saved data intact.
