# AI preferences

Dashboard → AI preferences controls workspace defaults through the existing `useAiSettings` API and `ai_settings` KV record. Model defaults save immediately; the master prompt has Save changes. The context maximum control remains hidden until native admission actually consumes the preference.

## Maximum context tokens

The dormant control is described here for integration and testing; it is not an exposed setting yet. When enabled alongside native admission, leave the field blank for **Use model limit**. New, legacy and reset preferences have no numeric default. Enter a positive whole integer and choose Save changes to record a custom maximum. Zero, negative, fractional, nonfinite, unsafe integer and malformed text are rejected with an inline validation message; a failed save leaves the input editable for retry.

Clear the field and save to restore Use model limit. Reset to defaults also clears it along with the other AI preferences. A saved maximum larger than one model's window stays saved when the default model changes; it cannot authorize exceeding that model's actual capacity. Preferences reload with the active workspace, and an old workspace's pending save cannot change the current page's input or error.

The persisted setting is `maxContextTokens: number | null`. This is a context-window preference, separate from the provider completion/output parameter. Capacity comes from advertised model metadata; occupancy/token usage can be estimated and must not be presented as authoritative capacity.

**Current implementation boundary:** Dashboard handlers, KV persistence and
immutable preference capture are implemented. Native initial send, retry,
continuation and foreground tool iterations apply the captured value without
fallback capacity, reply reserves or automatic trimming. The control remains
hidden while independent server admission, background reconnect and the final
meter are pending. A settings change applies to the next generation, not an
already admitted foreground loop. See [chat lifecycle](/documentation/architecture/chat-lifecycle)
and [model catalog](/documentation/auth/models-service) for those boundaries.
