# Portable Cloud Profile

The portable client profile (`or3-portable-client-v1`, profile version `1`) is a
single authoring configuration that generates two deterministic descriptor files
for a Manifest V2 package. It lets an unaware host reject a package cleanly and
lets the reviewer verify that a package stays browser-only, dependency-free and
migration-free.

Generate both descriptors with `defineOr3PortableProfile()` from
`@or3/plugin-sdk/profile` (Node-only authoring surface):

```ts
import {
    applyPortableProfileToManifest,
    defineOr3PortableProfile,
} from '@or3/plugin-sdk/profile';

const profile = defineOr3PortableProfile({
    profile: 'or3-portable-client-v1',
    destinations: [
        { id: 'weather-api', methods: ['GET'], hosts: ['api.weather.example'], scopes: ['forecast.read'] },
    ],
    connections: [
        {
            id: 'weather',
            label: 'Weather',
            provider: 'weather.example',
            required: true,
            mechanism: 'browser',
            scopes: ['forecast.read'],
            operations: ['forecast.lookup'],
        },
    ],
    dataScopes: ['documents.read'],
    writes: ['documents.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        { key: 'units', label: 'Units', kind: 'select', required: true, order: 1, default: 'metric', choices: ['metric', 'imperial'] },
    ],
    testAction: { operationId: 'forecast.lookup', deadlineMs: 5000 },
    firstAction: { operationId: 'forecast.lookup', label: 'Check forecast', usesSampleContext: true },
});

const manifest = applyPortableProfileToManifest(myManifest, profile);
// Write profile.files['or3.package-policy.json'] and profile.files['or3.setup.json'] to the package root.
```

## Descriptor files

`profile.files` contains byte-identical JSON for two files, each with 2-space
indentation, recursively sorted keys and a trailing newline:

- `or3.package-policy.json` — destinations, connections, data scopes, writes and
  `requiredFeatures`.
- `or3.setup.json` — settings schema path, setup fields, required connection ids,
  optional test action, and the first action.

`profile.revisions.policy` and `profile.revisions.setup` are kind-domain-separated
`sha256-<64 hex>` hashes (`OR3_PACKAGE_POLICY_V1\0` / `OR3_SETUP_DESCRIPTOR_V1\0`
plus the canonical bytes). They are not the package-tree digest. Arrays that are
semantically sets (hosts, scopes, operations, connections, features, methods,
choices) are sorted and deduplicated, so equivalent configurations produce
identical bytes and hashes.

## Required feature flag

The policy always requires the feature flag `or3-portable-client-v1`.
`applyPortableProfileToManifest()` merges it into `manifest.features.required`
and sets `manifest.settings.schema` to the setup schema path, so the manifest and
descriptors agree by construction. Hosts that do not implement the profile reject
the package instead of running it in an unsupported mode.

## Restrictions

| Area | Portable requirement |
| --- | --- |
| Trust | `manifest.trust === 'isolated-client'` |
| Client isolation | `worker` or `iframe` (never `host`) |
| Server code | No `manifest.runtime.server` (no native/server code) |
| Runtime entry | Relative `.mjs` / `.js`; no remote URLs |
| Plugin dependencies | `manifest.dependencies.required` / `.optional` empty |
| State | `rollback: 'safe'`, `version <= reads.maximum`, `reads.minimum <= reads.maximum` |
| package.json scripts | No `preinstall`, `install`, `postinstall`, `prepare` |
| package.json dependencies | Only `@or3/plugin-sdk` (`vue` as a peer; devDependencies allowed) |
| Setup connections | Every id declared in `policy.connections` |
| Setup operations | `testAction` / `firstAction` operations declared by a connection or destination |
| Grants | `dataScopes` / `writes` listed in `requestedGrants`; destinations/connections imply `network.http` |

`dataScopes` and `writes` use grant ids (`documents.read`, `documents.write`,
`storage.read`, `storage.write`, `settings.read`, `settings.write`).
Destinations or connections require the `network.http` grant.

## Validator codes

`validatePortableProfile({ manifest, policy, setup, packageJson })` returns
actionable findings using the conformance shape (`severity`, `code`, `subject`,
`message`). All portable findings are errors:

- `portable-profile-missing`
- `portable-profile-version-unsupported`
- `portable-feature-flag-missing`
- `portable-trust-unsupported`
- `portable-host-isolation-unsupported`
- `portable-server-code-unsupported`
- `portable-runtime-dependency-unsupported`
- `portable-state-migration-unsupported`
- `portable-lifecycle-script-unsupported`
- `portable-package-dependency-unsupported`
- `portable-remote-code-unsupported`
- `portable-settings-schema-mismatch`
- `portable-policy-grant-mismatch`
- `portable-setup-connection-unknown`
- `portable-setup-operation-unknown`
- `portable-feature-mismatch`

The same validator runs in `plugin-runtime:v2-conformance:check` whenever a
package declares `or3-portable-client-v1` or ships either descriptor file. See
[Plugin Manifest V2](./manifest-v2) and the [Plugin SDK](./plugin-sdk).

## First-action samples

`or3.setup.json` → `firstAction` may declare `samplePath`: a package-relative
path (no leading slash, no `..`) to the sample the host runs the first action on.
The rule is enforced both ways: `usesSampleContext: true` requires `samplePath`,
and `samplePath` is refused when `usesSampleContext` is false. The host resolves
it inside the package directory with a size bound and never guesses a filename.
