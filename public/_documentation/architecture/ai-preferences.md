# AI preferences

**Dashboard → AI Settings** controls workspace defaults through the `useAiSettings` API and `ai_settings` KV record. Model defaults save when selected. The master prompt saves after a short pause or when the field loses focus; the page also attempts to flush pending edits when it unmounts. Save status and retry controls appear where applicable. Open **Context limit** under Advanced to set the optional maximum used by native admission and the composer meter.

## Maximum context tokens

Leave the field blank for **Use model limit**. New, legacy and reset preferences have no numeric default. Enter a positive whole integer; it saves when the field loses focus or you press Enter (not while you type, so a half-typed number is never stored), with a pending save also attempted when the page unmounts. Zero, negative, fractional, nonfinite, unsafe integer and malformed text are rejected with an inline validation message; a failed save leaves the input editable for retry.

Clear the field to restore Use model limit. Reset to defaults also clears it along with the other AI preferences. A saved maximum larger than one model's window stays saved when the default model changes; it cannot authorize exceeding that model's actual capacity. Preferences reload with the active workspace, and an old workspace's pending save cannot change the current page's input or error.

The persisted setting is `maxContextTokens: number | null`. This is a context-window preference, separate from the provider completion/output parameter. Capacity comes from advertised model metadata; occupancy/token usage can be estimated and must not be presented as authoritative capacity.

**Current implementation boundary:** Dashboard handlers, KV persistence and
immutable preference capture are implemented. Native initial send, retry,
continuation and foreground tool iterations apply the captured value without
fallback capacity, reply reserves or automatic trimming. The composer meter and Summarize action use this setting; final provider rollout
and full model-quality qualification remain tracked in the compaction checklist.
Native server admission resolves capacity independently and durable job
checkpoints retain the captured maximum during tool iterations and reconnect.
A settings change applies to the next generation, not an already admitted
foreground or background loop. See [chat lifecycle](/documentation/architecture/chat-lifecycle)
and [model catalog](/documentation/auth/models-service) for those boundaries.

## Workspace loading and migration recovery

Existing settings consumers clear their former workspace values and load the
selected workspace when it changes. Failed or missing-row loads remain retryable.
Preference updates read the durable row strictly before merging, so a failed
read cannot silently turn an existing preference set into defaults.

Legacy browser settings are removed only after their guarded KV migration
commits. A failed write preserves the legacy copy for a subsequent load; a
concurrent replacement of that browser value is never removed by the old load.
