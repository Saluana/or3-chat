# Package and install a theme

A theme ZIP is installed by a system administrator through **Admin → Themes**.
The installer adds source files; theme discovery still happens at build time.
A production bundle must be rebuilt/redeployed and restarted after installation
or removal. Restarting an unchanged bundle cannot discover a new theme.

## Package contents and trust

| Tier | Required files | Allowed additions |
| --- | --- | --- |
| `declarative` | `or3.manifest.json`, `or3.theme.json` | Local CSS and non-executable assets |
| `trusted-code` | `or3.manifest.json`, `theme.ts` | TypeScript helpers, Vue replacements, CSS, local assets |

Use the complete declarative files from
[Build your first theme](/documentation/themes/first-theme). Declarative packages
cannot contain JS, TS, Vue, or CSS preprocessors, including a local preview
adapter. The installer validates the definition and writes its runtime `theme.ts`.
The definition name must match the manifest ID.

For a trusted-code theme, use this manifest, with your actual identity:

```json
{
  "kind": "theme",
  "id": "ocean-theme",
  "name": "Ocean",
  "version": "1.0.0",
  "capabilities": [],
  "themeTrust": "trusted-code",
  "componentContractVersion": 1
}
```

Keep the directory, manifest ID, and definition name equal for predictable
maintenance. A trusted definition can technically have a different name; the
compiler tracks its source directory separately. `componentContractVersion: 1`
is relevant when replacing components. A theme manifest has `kind: 'theme'`;
do not copy a workspace plugin's manifest schema. Version is a non-empty string;
use semantic versions for releases. Always declare `themeTrust` explicitly.
Packages that omit it follow the trusted-code compatibility path.

Installing trusted-code is installing application code. Review its source and
origin. The declarative tier restricts executable package files; it does not
make all possible CSS or assets appropriate for your site.

## Build and check before packaging

For a source preview/theme, from the checkout root:

```sh
bun run theme:validate ocean-theme
bun run theme:build-css
```

The second command is needed for `cssSelectors.style`. Configuration validation
is not TypeScript checking or UI conformance. For trusted changes, run the host's
appropriate typecheck and affected behavioral checks as well. Repeat the
[tutorial's appearance checks](/documentation/themes/first-theme#3-verify-the-appearance)
against the built deployment.

## Make the ZIP

Put one `or3.manifest.json` at the ZIP root. A single enclosing archive directory
is also accepted and stripped. Include every referenced stylesheet, component,
helper, font, and image. Exclude installed dependencies, Git data, local preview
adapters for declarative themes, and unrelated host files.

For the tutorial's exact two-file package, save this as `scripts/pack-declarative-theme.ts`
in the OR3 checkout and run it there. `fflate` is already a host dependency.

```ts
import { zipSync } from 'fflate';
import { resolve } from 'node:path';

const source = process.argv[2];
const destination = process.argv[3];
if (!source || !destination) {
  throw new Error('Usage: bun scripts/pack-declarative-theme.ts <folder> <output.zip>');
}
const files: Record<string, Uint8Array> = {};
for (const name of ['or3.manifest.json', 'or3.theme.json']) {
  files[name] = new Uint8Array(await Bun.file(resolve(source, name)).arrayBuffer());
}
await Bun.write(resolve(destination), zipSync(files));
```

```sh
bun scripts/pack-declarative-theme.ts /absolute/path/to/ocean-theme /absolute/path/to/ocean-theme.zip
```

This example intentionally includes only those two files. Extend the explicit
file list when adding CSS/assets. A trusted-code theme also needs its `theme.ts`
and all of its local imports. Inspect ZIP contents before uploading. Default
limits are 25 MiB compressed, 200 MiB unpacked, and 2,000 files; operators can
configure lower or higher limits and permitted extensions.

## Install and select

1. Sign in to the global admin panel and open **Themes**.
2. Use **Install .zip** to upload the package, or **Import from URL** with a
   direct HTTPS ZIP URL.
3. Review the result. An existing extension requires an explicit overwrite;
   an unmanaged source/built-in folder with the same ID blocks installation.
4. In development, restart the dev server. In production, follow the documented
   deployment update workflow in `docs/cloud-updates.md` to rebuild/redeploy
   and restart; do not assume the upload updated the running bundle.
5. Open **Dashboard → Theme**, select the theme, and repeat the light/dark,
   reload, switching, mobile, and keyboard checks.

Installed themes live under `extensions/themes/<id>/` and are linked into
`app/theme/<id>/`, with a managed copy fallback when symlinks are unavailable.
Static builds can include themes built into their source, but cannot expose
these administrator installation endpoints. URL imports reject private/reserved
addresses and validate each HTTPS redirect hop; a GitHub repository web page is
not itself a ZIP download.

## Advanced API example

Use the UI for normal installation. A same-origin authenticated admin page can
upload through the API:

```ts
const form = new FormData();
form.append('file', zipFile);
form.append('expectedKind', 'theme');
form.append('force', 'false');
const result = await $fetch('/api/admin/extensions/install', {
  method: 'POST',
  headers: { 'x-or3-admin-intent': 'admin' },
  body: form,
});
```

Here `zipFile` is the selected `File` and `$fetch` is the host's Nuxt helper.
The browser supplies the authenticated cookie and same-origin request source;
do not set multipart Content-Type manually. Non-browser clients must supply
valid admin authentication, `x-or3-admin-intent: admin`, and a matching Origin
or Referer. JSON URL/Base64 requests also need JSON Content-Type and
`expectedKind: 'theme'`. Overwrite uses explicit `force: true`.

## Update and remove

Install a new ZIP with the same ID and explicit overwrite to replace an
extension. Retain the previous package and verification evidence for recovery,
and rebuild/redeploy after replacement. Built-in themes are source-managed.

Use **Uninstall** for an installed extension, then rebuild/redeploy production
so the bundle no longer contains it. A removed theme selection falls back to an
available theme; deleting personal customizations is a separate action. See
[Troubleshooting](/documentation/themes/troubleshooting) for conflicts and
missing styles.
