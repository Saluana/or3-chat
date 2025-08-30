# design.md

artifact_id: 0d5e6a9c-bf1b-4d42-9c8e-70f4dfb90f3e

## Overview

Implement minimal reasoning token capture & display. On API response handling for assistant messages, extract `message.reasoning` (string) or `message.reasoning_details` (array) returned by OpenRouter and store inside `Message.data` as:

```
Message.data = {
  ... (existing),
  reasoning_content?: string,      // Plain combined reasoning text
  reasoning_details?: any[]        // Raw provider objects (optional)
}
```

No schema change: `MessageSchema.data` already allows unknown. UI update in `ChatMessage.vue` will render an accordion above assistant prose if `reasoning_content` exists.

## Architecture

Flow:

1. API completion fetch -> existing code building MessageCreate.
2. Normalize reasoning:
    - If `response.choices[0].message.reasoning_details` present: collect all objects; derive text by concatenating any `summary` + `text` fields in order.
    - Else if `response.choices[0].message.reasoning` (string) present: use directly.
3. Attach to `data` before persisting.
4. UI component (`ChatMessage.vue`) reads `props.message.data?.reasoning_content` and conditionally renders `<ReasoningAccordion>` inline (implemented local inside same file for brevity) with toggle state stored on message (`_reasoningExpanded`).

## Component Changes

Single file edit: `ChatMessage.vue`.
Add computed:

```
const reasoningContent = computed(() => {
  const d = (props.message as any).data;
  if (!d || typeof d !== 'object') return '';
  const txt = (d as any).reasoning_content;
  return typeof txt === 'string' && txt.trim() ? txt : '';
});
```

Render block (above existing message body):

```
<div v-if="reasoningContent" class="mb-2">
  <button ... @click="toggleReasoning" :aria-expanded="reasoningExpanded">
    <span>{{ reasoningExpanded ? 'Hide reasoning' : 'Show reasoning' }}</span>
    <span v-if="!reasoningExpanded" class="opacity-70 text-xs">({{ reasoningCharCount }} chars)</span>
  </button>
  <transition name="fade">
    <pre v-show="reasoningExpanded" class="reasoning-box">{{ reasoningContent }}</pre>
  </transition>
</div>
```

State:

```
const reasoningExpanded = ref((props.message as any)._reasoningExpanded || false);
watch(reasoningExpanded, v => (props.message as any)._reasoningExpanded = v);
function toggleReasoning() { reasoningExpanded.value = !reasoningExpanded.value; }
```

Style additions (scoped): minimal retro look: border, pixel shadow, monospace.

## Reasoning Normalization Function (New util)

Add small utility in `utils/models-service.ts` (or wherever completions handled) to stay DRY:

```
export function extractReasoning(rawMsg: any): { reasoning_content?: string; reasoning_details?: any[] } {
  if (!rawMsg) return {};
  const details = rawMsg.reasoning_details;
  if (Array.isArray(details) && details.length) {
    const parts: string[] = [];
    for (const r of details) {
      if (r && typeof r === 'object') {
        if (typeof r.summary === 'string') parts.push(r.summary);
        if (typeof r.text === 'string') parts.push(r.text);
      }
    }
    const reasoning_content = parts.join('\n\n').trim();
    return { reasoning_content, reasoning_details: details };
  }
  const str = rawMsg.reasoning;
  if (typeof str === 'string' && str.trim()) return { reasoning_content: str.trim() };
  return {};
}
```

Integrate where message objects created: merge into `data` if any field present.

## Error Handling

-   If `data` not object, coerce to `{}`.
-   Ignore reasoning extraction failures silently (keep small). No thrown errors.

## Performance

Simple string concatenation only. No markdown rendering for reasoning (display raw). Capped height via CSS.

## Testing Strategy

-   Unit: test `extractReasoning` with: only reasoning string, reasoning_details array mixed types, empty, malformed entries.
-   Component: shallow mount modified `ChatMessage.vue` with reasoning content present/absent ensuring accordion toggles and isolates state.
-   Manual: Send request to reasoning-capable model and verify persistence after reload.

## Accessibility

-   Button labeled (Show/Hide reasoning) + aria-expanded.
-   Pre block focusable via keyboard scroll.

## Minimal CSS Snippet

```
.reasoning-box { max-height: 300px; overflow:auto; font-family: 'VT323','IBM Plex Mono',monospace; font-size:12px; padding:6px 8px; background:var(--md-surface-container-low); border:2px solid var(--md-inverse-surface); border-radius:4px; box-shadow:0 0 0 1px #000 inset; white-space:pre-wrap; }
.reasoning-toggle { font-family:'VT323','IBM Plex Mono',monospace; font-size:13px; padding:4px 8px; border:2px solid var(--md-inverse-surface); background:linear-gradient(180deg,var(--md-surface-container-high) 0%, var(--md-surface-container-low) 100%); border-radius:4px; box-shadow:2px 2px 0 0 var(--md-inverse-surface); display:flex; gap:6px; align-items:center; }
.reasoning-toggle:focus { outline:2px solid var(--md-inverse-primary); outline-offset:2px; }
```

## Open Questions / Assumptions

-   Assume existing message creation layer centrally available; add reasoning extraction inline if simpler than new util.
-   Streaming partial reasoning not required (store only final).

## Conclusion

Lightweight addition: small util + minimal UI injection in one component. No migrations or additional deps; aligns with simplicity requirement.
