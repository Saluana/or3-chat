# AI preferences

Dashboard → AI preferences controls workspace defaults through the existing `useAiSettings` API and `ai_settings` KV record. Model defaults save immediately; the master prompt and maximum context each have Save changes.

## Maximum context tokens

Leave the field blank for **Use model limit**. New, legacy and reset preferences have no numeric default. Enter a positive whole integer and choose Save changes to record a custom maximum. Zero, negative, fractional, nonfinite, unsafe integer and malformed text are rejected with an inline validation message; a failed save leaves the input editable for retry.

Clear the field and save to restore Use model limit. Reset to defaults also clears it along with the other AI preferences. A saved maximum larger than one model's window stays saved when the default model changes; it cannot authorize exceeding that model's actual capacity. Preferences reload with the active workspace, and an old workspace's pending save cannot change the current page's input or error.

The persisted setting is `maxContextTokens: number | null`. This is a context-window preference, separate from the provider completion/output parameter. Capacity comes from advertised model metadata; occupancy/token usage can be estimated and must not be presented as authoritative capacity.

**Current implementation boundary:** Dashboard persistence and immutable preference capture are implemented. Native foreground/background/reconnect admission consumption is still pending; saving this control does not yet replace the native fallback, reply reserve or history trimming. The final meter and independent server admission also remain pending. See [chat lifecycle](/documentation/architecture/chat-lifecycle) and [model catalog](/documentation/auth/models-service) for those boundaries.
