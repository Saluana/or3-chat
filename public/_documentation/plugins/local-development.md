# Local Development Candidates

Test an unpublished plugin candidate as a real plugin inside OR3 Chat without
publishing every iteration. Candidates are immutable SDK outputs; the
development instance admits them through the same validation, grant review,
canary and promotion machinery as signed releases, with explicitly labeled
local provenance instead of a marketplace signature.

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

Start it with:

```sh
bun run dev:plugin
```

This creates `.or3-plugin-dev/` (extensions, SQLite sync database,
basic-auth database), sets `OR3_PLUGIN_DEVELOPMENT=1` and
`OR3_PLUGIN_DEV_PROFILE`, and serves SSR on `127.0.0.1:3101`. Package
selection stays instance-wide inside that instance; the ordinary app's
registry, production package pointers and user data are outside it.

Admission requires all of these independently: the flag, a development build
(production builds reject admission even with the flag set), the dedicated
profile with all data roots inside it, a direct loopback connection
(forwarded headers are never trusted), an authenticated owner, and a
same-origin mutation context.

## The workflow

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
   marketplace validation, reviewer approval or signer authorization.

Replacing a candidate of the same version admits the new digest, preserves
the instance's plugin data, cleans up the old activation, and requires fresh
authority review where grants changed. There is no automatic data-safe
rollback, and storage is never cleared by admission or replacement.

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
