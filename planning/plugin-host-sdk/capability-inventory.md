# SDK capability inventory

This table separates contract/harness progress from production qualification.
An adapter being registered or advertised does not establish installed behavior.
No current-commit installed receipt is recorded here. All installed qualification
remains open, including existing portable methods. See tasks.md for receipt
bindings; generic V2 setup activation and portable dispatch are distinct paths.

| Namespace | Methods | Adapter status | Grant family | Local evidence (not installed qualification) |
| --- | --- | --- | --- | --- |
| `settings` | `get`, `list`, `set`, `delete` | portable setup adapter; user preferences reserved; event parity open | `settings.read/write` | portable runtime tests; setup value/schema tests |
| `storage` | `get`, `getRecord`, `set(ifRevision)`, `delete`, `list`, `listPage` | portable adapter; workspace/plugin prefix, byte cap and KV-clock CAS; installed races open | `storage.read/write` | portable-client-runtime tests; SDK harness CAS/page tests |
| `ai` | `models`, `complete` | existing governed remote methods; typed facade added; installed SDK dispatch open | current `network.http` review | host-capability and portable SDK tests |
| `ui` | sidebar/pane/card/action registration, toast, confirm, progress | harness only | proposed `ui.*` | `PluginTestHost` dispatch; registry entries remain unqualified |
| `panes` | `open`, `focus`, `close` | harness only; opaque refs and dedup rules | proposed `panes.open` | SDK harness pane/replace tests |
| `commands` | `register`, `run` | harness only; lifecycle-bound handlers | proposed `commands.register` | SDK harness install → command test |
| `chat` | `create`, `open`, `appendMessage` | typed contract and harness; generic production adapter unqualified | proposed `chat.*` | `chat-schema.ts`; SDK harness chat tests; no installed receipt |
| `workspace` | `id`, `onChange`, `switch`, connection projection | harness lifecycle; production scope captured by portable storage | proposed `workspace.*` | SDK workspace switch test; runtime activation receipts |
| `events` | typed `on` for workspace/settings/chat/connections/resume | harness only | proposed `events.register` | SDK event filtering implementation; no host advertisement |
| `secrets` | `get`, `set`, `delete`, `ref`, `status`, `unlock` | harness custody seam only | proposed `secrets.*` | secret/file harness; production vault remains gated |
| `files` | `pick`, bounded `read`, staged `write` | harness custody seam only | proposed `files.*` | secret/file harness; production attachment adapter remains gated |
| `http` | `fetch`, compatibility `request` | typed unsupported default; current remote AI/connection bridge remains separate | current `network.http` bridge; SDK adapter unqualified | unsupported-result test and existing capability bridge tests |
| `network` | `stream` | proposed; no host method registered | proposed `network.stream` | injected-clock stream probe |
| `activity` | `registerSource` | harness only | proposed `activity.register` | activity contract inventory; production registry adapter remains gated |

The context shape can therefore stay stable without making an unqualified
capability appear installed. Compatibility uses the qualification registry in
`server/admin/plugins/v2-host-capabilities.ts`; adding a string to
`PluginGrant` does not add it to the host's advertised authority.
