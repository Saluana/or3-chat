# Develop a plugin locally

For the complete scaffold-to-publication path, start with [Build and publish
a V2 plugin](./plugin-development-v2).

From an OR3 Chat source checkout with dependencies installed, its sibling
`or3-provider-basic-auth` source checkout, and Bun 1.3.6 or newer on PATH,
create a portable plugin anywhere on your machine:

```sh
cd <path-to-or3-chat>
bun run dev:plugin --create /absolute/path/to/my-plugin --id or3.my-plugin
```

The command packs the local SDK, creates the starter, installs its dependencies,
and starts a dedicated host. Open the printed loopback URL if your browser did
not open automatically. Sign in once with the local password printed by the
command and review the starter's requested permissions. No checkout `.env`,
remote service credentials, or repeated file uploads are needed. The local
development host skips the ordinary first-run OpenRouter prompt; a model key is
only needed if you choose to test chat features that use one.

After that, work from the plugin directory:

```sh
cd /absolute/path/to/my-plugin
bun run dev
```

Save `client.mjs` or another package source file. The host builds a candidate,
runs its normal admission and browser canary, and opens the plugin in the real
Chat workspace. Each save updates that plugin pane without a page reload. A
build error shows the source location and keeps the last running package. Fix
the file and save again. Review new permissions when your edit expands
authority. Test the plugin's sidebar, pane, tool and storage behavior in Chat.
Persistent plugin settings and storage
survive replacement; in-memory worker state starts over on each activation.

The local `.or3-dev/host.json` remembers the host checkout and is ignored by
Git and candidate snapshots. If you created a plugin separately, link it once
with `bun run dev --host /absolute/path/to/or3-chat`. Run `bun install` in the
plugin directory after changing dependencies. This watched path supports
portable isolated-client V2 plugins.

The development instance admits immutable SDK candidates through the same
validation, grant review, canary and promotion machinery as signed releases,
with labeled local provenance instead of a marketplace signature.

## The candidate

`or3-plugin candidate` freezes one testable unit from a package source (see
the [plugin SDK CLI](./plugin-sdk-cli)):

- `package.zip` — the deterministic package archive that will run.
- `source.zip` — the source snapshot it was built from (secrets excluded).
- `receipt.json` — the machine-readable receipt binding plugin, version,
  package/manifest/source/authority digests, required host features, source
  revision with dirty-snapshot status, and actual SDK, lockfile and runtime
  inputs.

Testing and submission consume those exact files: they verify digests without
rebuilding. A changed source is a new candidate directory, never a mutated
one. Only a clean, release-policy-compliant rebuild that compares byte-equal
with the frozen candidate qualifies for publication (`candidate --qualify`).

## The dedicated instance

Unpublished candidates run in a dedicated, loopback-only development instance
with separate application data and extension storage — never as a
workspace-local override in a shared instance, and never in production.

For a manual candidate workflow, start an instance without `--create` or
`--plugin`:

```sh
bun run dev:plugin
```

This creates `.or3-plugin-dev/` (extensions, SQLite sync database,
basic-auth database, filesystem blob storage), sets `OR3_PLUGIN_DEVELOPMENT=1` and
`OR3_PLUGIN_DEV_PROFILE`, pins the effective backing services to the local
profile (`basic-auth`/`sqlite`/`fs`), enables the V2 module loader that runs admitted
packages, and serves SSR on loopback at `127.0.0.1:3101`. Watched startup picks
a free loopback port if 3101 is occupied; use the printed URL. Package
selection stays instance-wide inside that instance; the ordinary app's
registry, production package pointers and user data are outside it.

Admission requires all of these independently: the flag, a development build
(production builds reject admission even with the flag set), the dedicated
profile with all data roots inside it, local backing providers (a remote
auth, sync or storage provider makes the instance ineligible; watched startup
clears inherited checkout configuration and pins its own local profile), a direct loopback connection
(forwarded headers are never trusted), an authenticated owner, and a
same-origin mutation context.

## Manual candidate workflow

In the development instance, open Admin > Plugins > Development candidate:

1. Select `package.zip`, `source.zip` and `receipt.json`, inspect the
   identity, authority and source revision, and admit the candidate. Archive
   abuse protections, profile checks, grant review, setup and state checks
   still apply; denied grants block admission.
2. Run the canary and promote with the existing package controls. The admitted
   package is labeled **Development candidate**, never a marketplace release.
3. Open the plugin from Chat: it runs in the real isolated worker with real
   sidebar, pane, tool and storage integrations.
4. Export the verification receipt (runtime canary, or a separately labeled
   recorded interaction check). Receipts are developer-supplied evidence bound
   to the candidate and host build; they never substitute for trusted
   marketplace validation, reviewer approval or signer authorization. The
   receipt names the candidate by its canonical receipt digest (not the raw
   upload bytes), which is the identity the marketplace binds the report to.

Replacing a candidate of the same version admits the new digest, preserves
the instance's plugin data, cleans up the old activation, and requires fresh
authority review where grants changed. There is no automatic data-safe
rollback, and storage is never cleared by admission or replacement.

Watched candidates are disposable local test outputs. To hand off a version for
review, create and verify an explicit frozen candidate from a clean commit:

```sh
or3-plugin candidate . --out ../candidates/my-plugin-1
or3-plugin candidate --verify ../candidates/my-plugin-1
or3-plugin candidate --qualify . --candidate ../candidates/my-plugin-1
```

Qualification requires matching clean source and dependencies. The watched
build is never silently submitted or treated as release evidence.

When the candidate is ready for review, attach its frozen `receipt.json` (and
optionally the verification receipt) to a marketplace draft submission: the
marketplace binds the receipt to the exact uploaded bytes, freezes it with
the revision, and keeps it visibly distinct from trusted validation evidence.
Approval still rests on independently inspected runner evidence alone.

## Trust boundary

- Signature verification, immutable releases, workspace grants and worker
  isolation are unchanged. Ordinary raw-upload restrictions are unchanged.
- The development instance must never share storage with production or the
  everyday development checkout. Its `.or3-plugin-dev/` directory is local
  only and never committed.
- Verification receipts identify package, source and provenance digests, host
  build and features, scope, timestamp and outcome. They carry no credentials
  or plugin content.

## Related

- [Native Marketplace](./marketplace) — installed versus running, recovery limits.
- [Trusted Registry Acquisition](./trusted-acquisition) — the install pipeline this reuses.
- [Plugin SDK CLI](./plugin-sdk-cli) — the `candidate` command and receipt schemas.
