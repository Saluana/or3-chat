# Publish your plugin

Publish the exact package you tested. A release candidate contains a package
archive, its source snapshot, and a receipt that binds their identities. The
marketplace independently validates and reviews those files before signing and
publication.

Finish [Build your first plugin](/documentation/plugins/first-plugin) first. You need a developer
profile whose namespace owns your plugin ID and submission eligibility enabled
by the marketplace operator. A local development host or Git push does not
publish a plugin.

## 1. Prepare a clean source revision

From the plugin directory, run:

```sh
bun run profile:check
./node_modules/.bin/or3-plugin validate .
./node_modules/.bin/or3-plugin test .
```

For a trusted-host package without profile generation, omit `profile:check`.
Run its own typecheck and behavior checks too. Commit source, tests, generated
descriptors, and the lockfile. Keep installed dependencies, build output, local
host profiles, and credentials out of Git. Use a clean revision and an unused
version when the release bytes change.

## 2. Freeze and qualify a candidate

Choose a new output directory outside the package source:

```sh
./node_modules/.bin/or3-plugin candidate . --out ../candidates/greeting-1
./node_modules/.bin/or3-plugin candidate --verify ../candidates/greeting-1
./node_modules/.bin/or3-plugin candidate --qualify . --candidate ../candidates/greeting-1
```

| File | Purpose |
| --- | --- |
| `package.zip` | The deterministic built package that will run |
| `source.zip` | The source snapshot used to reproduce it |
| `receipt.json` | Package, source, authority, revision, SDK, lockfile, and runtime identities |

`--verify` checks the frozen files without rebuilding. `--qualify` rebuilds
from the frozen source with matching clean revision and dependency inputs and
requires byte-equal output. A dirty candidate can be tested locally, but cannot
qualify for publication. After a source change, create a new candidate directory;
do not replace files in the old one. A separately packed `.or3pkg` is useful for
inspection, but the three candidate files above are the submission handoff.

## 3. Exercise the frozen files in OR3

The watched development loop checks disposable candidates as you edit. For
release verification, test the explicit frozen candidate too. From the OR3
Chat source checkout:

```sh
bun run dev:plugin
```

Open the printed loopback URL and sign in as the local owner. The manual host
must meet the [development admission requirements](/documentation/plugins/runtime-and-security#local-development-admission).
In **Admin → Plugins → Development candidate**:

1. Select the candidate's `package.zip`, `source.zip`, and `receipt.json`.
2. Review requested access, admit it, run the candidate check, and promote it.
3. Enable it in the test workspace, open it, and exercise its useful action.
4. Verify required setup, saved data, disable/re-enable, and any relevant
   workspace switching. Model calls incur the displayed provider costs.
5. Export the developer verification receipt and retain your screenshots or
   other repeatable interaction evidence with the candidate.

The receipt identifies what you tested. It is developer-supplied evidence,
not marketplace validation or signing approval.

## 4. Create a marketplace draft

The source checkout includes a draft preparation CLI. From that checkout:

```sh
bun run marketplace:submit -- login
```

Login opens the marketplace with a local PKCE callback. For a headless terminal,
use `bun run marketplace:submit -- login --device` and approve the displayed
code in your browser. The CLI stores revocable credentials in a private user
config file.

Prepare a JSON listing, replacing the example links with your public HTTPS pages:

```json
{
    "category": "productivity",
    "tags": ["productivity"],
    "supportUrl": "https://example.com/support",
    "privacyUrl": "https://example.com/privacy",
    "externalCostNote": "No external charges are required."
}
```

Choose a category and tags offered by the target marketplace; the values above
are examples. Use support and privacy pages that describe this plugin.

Run the CLI with the frozen candidate, its matching clean source checkout,
and the listing:

```sh
bun run marketplace:submit -- /absolute/path/to/candidates/greeting-1 \
    --source /absolute/path/to/greeting \
    --listing /absolute/path/to/listing.json
```

It verifies and qualifies the candidate, uploads the exact package and source,
attaches the receipt, saves listing fields, and opens the draft. It defaults to
the staging marketplace and never signs or publishes a release. Use `--draft`
to stop at draft preparation. Fix listing blockers and resume with:

```sh
bun run marketplace:submit -- --resume <submission-id> --listing /absolute/path/to/listing.json
```

You can also create the draft in the staging marketplace's **Developers →
Submissions** page: upload `package.zip` and `source.zip`, complete the listing,
and attach the matching `receipt.json`. Attach your developer verification
receipt if you have one. A digest mismatch requires a new consistent candidate.

## 5. Submit and follow review

Complete recent account verification in the browser, then select **Submit for
review** when the checklist allows it. Uploading a draft does not establish
submission eligibility. The marketplace applies its current verification policy;
production requires MFA.

| Status | Next step |
| --- | --- |
| Uploaded / Validating | Wait for independent validation of the uploaded bytes |
| In review | A reviewer evaluates the current listing and trusted evidence |
| Changes requested / Rejected | Address findings; upload a new frozen candidate for code changes |
| Approved | The operator completes signing approval and publication |
| Published | Retain the publication receipt; that version's bytes are immutable |

Support URL should explain where users get help. Privacy URL should explain
data use and removal even if the plugin collects no data. External costs should
name required paid services beyond the plugin price. Declare the SPDX license
in the [manifest](/documentation/plugins/manifest).

After staging publication, acquire the signed release on a staging-configured
host, compare its package identity with the publication receipt, and repeat your
interaction check. Staging publication does not publish to production. Use that
environment's separate review and signing process.

## Common blockers

| Blocker | Fix |
| --- | --- |
| Dirty source or mismatched dependency inputs | Commit the intended source and lockfile, then create a new candidate |
| Qualification bytes differ | Fix nondeterministic build inputs; never overwrite the tested archive |
| Plugin ID outside your namespace | Correct the ID and regenerate descriptors before freezing |
| Unsupported permission or runtime | Use the [SDK support table](/documentation/plugins/plugin-sdk#supported-operations) and change the package |
| Receipt mismatch | Upload package, source, and receipt from the same frozen directory |
| Submission ineligible | Resolve developer-profile eligibility with the operator |

Use `bun run marketplace:submit -- --help` for all options and
`bun run marketplace:submit -- logout` to revoke and remove the saved CLI login.
See the [CLI reference](/documentation/plugins/plugin-sdk-cli) for packaging commands.
