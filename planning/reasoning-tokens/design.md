# design.md

artifact_id: 0d5e6a9c-bf1b-4d42-9c8e-70f4dfb90f3e

## Overview

Goal: unified capture + streaming + final display of reasoning tokens with zero layout shift and minimal code. We add:

1. A tiny normalization util `extractReasoning`.
2. A streaming buffer + throttle flush in the existing completion handler.
3. Reusable `ReasoningAccordion.vue` used by both tail (in-flight) and finalized messages.

No schema changes: reasoning lives solely in `Message.data` (`reasoning_content`, optional `reasoning_details`).

## High-Level Flow

```mermaid
flowchart TD
  A(User sends prompt) --> B(Stream starts)
  B --> C{Delta type?}
  C -->|reasoning delta| D[Append to reasoningBuffer]
  C -->|content delta| E[Append to message text]
  D --> F[Throttle flush -> reactive ref]
  E --> G[Render main content]
  F --> H[ReasoningAccordion (streaming)]
  B --> I[Detect capability -> show placeholder]
  G --> J[Final chunk]
  F --> J
  J --> K[extractReasoning(final raw msg)] --> L[Persist in message.data]
  L --> M[ChatMessage uses same accordion]
```

## Core Pieces

### 1. Reasoning Extraction Util

Contract:

```
type ExtractResult = {
  reasoning_content?: string;
  reasoning_details?: any[];
}
function extractReasoning(raw: any, opts?: { maxChars?: number }): ExtractResult
```

Rules:

-   Prefer `raw.reasoning_details` array (aggregate `summary`, then `text` fields in order with blank line separation).
-   Else fallback to `raw.reasoning` string.
-   Trim; if empty return `{}`.
-   Soft truncate if length > `maxChars` (default 100_000) append `\n[truncated]`.

Pseudo:

```
export function extractReasoning(raw:any,{maxChars=100000}={}){
  if(!raw) return {};
  const det = raw.reasoning_details;
  let text = '';
  if(Array.isArray(det) && det.length){
    const parts:string[]=[];
    for(const r of det){
      if(r && typeof r==='object'){
        if(typeof r.summary==='string') parts.push(r.summary);
        if(typeof r.text==='string') parts.push(r.text);
      }
    }
    text = parts.join('\n\n');
  } else if(typeof raw.reasoning==='string') {
    text = raw.reasoning;
  }
  text = text.trim();
  if(!text) return {};
  if(text.length>maxChars) text = text.slice(0,maxChars)+"\n[truncated]";
  return det && det.length ? { reasoning_content:text, reasoning_details:det }: { reasoning_content:text };
}
```

### 2. Streaming Buffer Logic

-   Maintain non-reactive `reasoningBuffer: string` and a `shallowRef('')` called `reasoningContentRef`.
-   On each reasoning delta append to buffer and schedule a flush if none pending:

```
if(!flushScheduled){
  flushScheduled=true;
  setTimeout(()=>{ reasoningContentRef.value = reasoningBuffer; flushScheduled=false; }, throttleMs);
}
```

-   `throttleMs` = 80–120 (config constant). Use `requestAnimationFrame` inside timeout for smoother sync.
-   On final chunk call `extractReasoning(finalRaw)` and overwrite both `reasoningBuffer` & `reasoningContentRef` with normalized final string (ensures consistency if provider changed ordering).
-   Persist by merging into `message.data` before saving.

### 3. Capability Detection

Simple list (config):

```
const REASONING_MODELS = [/deepseek/i, /o3/i, /r1/i, /reason/];
function modelSupportsReasoning(id:string){ return REASONING_MODELS.some(r=>r.test(id)); }
```

Used to set `pending=true` on accordion before first token so layout reserved.

### 4. Reusable Component: `ReasoningAccordion.vue`

Props:

```
interface Props {
  content?: string;
  streaming?: boolean;   // true while final not yet persisted
  pending?: boolean;     // expecting reasoning but none yet
  collapsedLabel?: string; // default 'Show reasoning'
  expandedLabel?: string;  // default 'Hide reasoning'
}
```

State:

```
const expanded = ref(false);
```

Computed / helpers:

```
const visible = computed(()=> !!props.content || props.pending);
const charCount = computed(()=> (props.content||'').length);
```

Template (outline):

```
<div v-if="visible" class="reasoning-wrap">
  <button class="reasoning-toggle" @click="expanded=!expanded" :aria-expanded="expanded" :aria-controls="id">
    <span v-if="!props.pending || props.content">{{ expanded? (expandedLabel||'Hide reasoning') : (collapsedLabel||'Show reasoning') }}</span>
    <span v-else>Thinking…</span>
    <span v-if="!expanded && props.content" class="count text-xs opacity-70">{{ charCount }} chars</span>
    <span v-if="props.streaming && !props.content && props.pending" class="pulse" aria-hidden="true"></span>
  </button>
  <transition name="fade">
    <pre v-show="expanded" :id="id" class="reasoning-box" tabindex="0">{{ props.content }}</pre>
  </transition>
  <slot name="footer" /> <!-- optional future extension -->
</div>
```

Styling (scoped minimal, reuse existing variables):

```
.reasoning-wrap { margin-bottom: .5rem; }
.reasoning-toggle { display:inline-flex; align-items:center; gap:.5rem; font-family: var(--font-mono, 'VT323','IBM Plex Mono',monospace); font-size:13px; padding:4px 8px; border:2px solid var(--md-inverse-surface); background:linear-gradient(180deg,var(--md-surface-container-high),var(--md-surface-container-low)); border-radius:4px; box-shadow:2px 2px 0 0 var(--md-inverse-surface); min-height:32px; }
.reasoning-box { max-height:300px; overflow:auto; font:12px/1.35 var(--font-mono,'VT323','IBM Plex Mono',monospace); padding:6px 8px; background:var(--md-surface-container-low); border:2px solid var(--md-inverse-surface); border-radius:4px; white-space:pre-wrap; box-shadow:0 0 0 1px #000 inset; }
.pulse { width:8px; height:8px; border-radius:50%; background:var(--md-primary); animation:pulse 1.2s infinite ease-in-out; }
@keyframes pulse { 0%,100%{opacity:.25} 50%{opacity:1} }
```

### 5. Integration Points

1. Model service streaming handler: add reasoning delta recognition (depending on provider payload shape; assume fields on delta message as with final). Append to reasoning buffer.
2. Tail streaming message component (whatever currently renders partial assistant content) imports `ReasoningAccordion` and passes `{ content: reasoningContentRef.value, streaming: true, pending: capability && !firstReasoningSeen }`.
3. Final message render (`ChatMessage.vue`): if `message.data.reasoning_content` present, pass as `content` with `streaming=false` and `pending=false`.
4. Persist final reasoning by merging extract result into `message.data` prior to DB write or local storage update.

### 6. Error Handling & Resilience

-   Fail-soft: any parse errors swallowed, reasoning simply absent.
-   If buffer grows beyond soft cap mid-stream, append truncation marker and stop further accumulation to prevent memory balloon.
-   Guard against non-string deltas: ignore.

### 7. Performance Considerations

-   Throttled flush ensures max ~12 updates per second.
-   Using `shallowRef` avoids deep diff cost.
-   Accordion hidden DOM when collapsed; expanded pre block uses `pre-wrap` to avoid extra Markdown parsing.
-   Capability prediction avoids measuring/layout twice; placeholder inserted once at message creation.

### 8. Testing Strategy

Unit:

-   `extractReasoning` scenarios (string only, details array, mixed invalid, empty, truncation).
-   Streaming throttle: simulate rapid 30 delta calls; assert flush count ≤ expected.

Component:

-   Renders placeholder when pending & no content.
-   Does not render when no pending and no content.
-   Toggle updates `aria-expanded` and reveals content.
-   Long content gets scroll + capped height.

Integration (light):

-   Simulated stream building final; final persisted reasoning equals composed buffer.

Manual:

-   Use a known reasoning model; expand mid-stream; verify no layout shift when first token arrives.

### 9. Accessibility

-   Button labeled; counts announced as plain text.
-   Focus ring preserved; high-contrast friendly using existing theme variables.

### 10. Future Extensions (Not Implemented Now)

-   Syntax highlighting for reasoning steps.
-   Collapsible nested sections if provider adds structured steps.

## Conclusion

Design supplies unified streaming + final reasoning experience with minimal code, no layout shift, and reusability via a dedicated component while meeting all new requirements.
