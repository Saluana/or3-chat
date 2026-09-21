# SDK capability inventory

This table is the contract and qualification index for the first SDK slice.
`qualified` means the current host advertises and re-checks the method;
`harness` means the typed test host exercises the behavior; `proposed` is
typed but intentionally absent from `supportedGrants` until a production
adapter and evidence exist.

| Namespace | Methods | Adapter status | Grant family | Evidence |
| --- | --- | --- | --- | --- |
| `settings` | `get`, `list`, `set`, `delete` | qualified for current setup settings; delete now follows schema reset | `settings.read/write` | portable runtime tests; setup value/schema tests |
| `storage` | `get`, `getRecord`, `set(ifRevision)`, `delete`, `list`, `listPage` | qualified; workspace/plugin prefix, byte cap and KV-clock CAS | `storage.read/write` | portable-client-runtime tests; SDK harness CAS/page tests |
| `ai` | `models`, `complete` | qualified through existing governed remote methods; typed facade added | current `network.http` review | host-capability and portable SDK tests |
| `ui` | sidebar/pane/card/action registration, toast, confirm, progress | harness only | proposed `ui.*` | `PluginTestHost` dispatch; registry entries remain unqualified |
| `panes` | `open`, `focus`, `close` | harness only; opaque refs and dedup rules | proposed `panes.open` | SDK harness pane/replace tests |
| `commands` | `register`, `run` | harness only; lifecycle-bound handlers | proposed `commands.register` | SDK harness install → command test |
| `workspace` | `id`, `onChange`, `switch`, connection projection | harness lifecycle; production scope captured by portable storage | proposed `workspace.*` | SDK workspace switch test; runtime activation receipts |
| `events` | typed `on` for workspace/settings/chat/connections/resume | harness only | proposed `events.register` | SDK event filtering implementation; no host advertisement |
| `secrets` | `get`, `set`, `delete`, `ref`, `status`, `unlock` | harness custody seam only | proposed `secrets.*` | secret/file harness; production vault remains gated |
| `files` | `pick`, bounded `read`, staged `write` | harness custody seam only | proposed `files.*` | secret/file harness; production attachment adapter remains gated |
| `http` | `fetch`, compatibility `request` | typed unsupported default; current remote AI/connection bridge remains separate | current `network.http` only where already qualified | unsupported-result test and existing capability bridge tests |
| `network` | `stream` | proposed; no host method registered | proposed `network.stream` | injected-clock stream probe |
| `activity` | `registerSource` | harness only | proposed `activity.register` | activity contract inventory; production registry adapter remains gated |

The context shape can therefore stay stable without making an unqualified
capability appear installed. Compatibility uses the qualification registry in
`server/admin/plugins/v2-host-capabilities.ts`; adding a string to
`PluginGrant` does not add it to the host's advertised authority.
