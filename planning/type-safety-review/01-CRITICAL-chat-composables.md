# CRITICAL: Chat Composables Type Safety Review

**Severity: BLOCKER**

**Total occurrences: 65+ in useAi.ts alone**

## Executive Summary

The `useAi.ts` composable is the core chat logic and has 65+ `any` type usages representing significant type holes. This is a **critical risk** because:

1. **Data integrity**: Messages, content parts, and tool calls lack type safety
2. **Runtime errors**: Unsafe casts lead to potential crashes when data shape changes
3. **Maintenance burden**: Type holes hide breaking changes during refactors
4. **Business logic risk**: Chat is the primary feature; bugs here block users

---

## Findings by Severity

### BLOCKER: Unsafe Global API Access

**File:** `app/composables/chat/useAi.ts`

**Lines:** 94, 97, 301

```typescript
// Line 94-99
const mpApi: any = (globalThis as any).__or3MultiPaneApi;
if (!mpApi?.panes?.value) return null;
const pane = mpApi.panes.value.find(
    (p: any) =>
        p.mode === 'chat' && p.threadId === threadIdRef.value
);
```

**Why:** 
- Bypasses all type checking on a global singleton
- `find` callback parameter loses type information
- Breaks if API shape changes

**Fix:**
```typescript
// Define interface
interface MultiPanePane {
    mode: string;
    threadId?: string;
}

interface MultiPaneApi {
    panes: { value: MultiPanePane[] };
}

// Use it
const mpApi = (globalThis as any).__or3MultiPaneApi as MultiPaneApi | undefined;
if (!mpApi?.panes?.value) return null;
const pane = mpApi.panes.value.find(
    (p) => p.mode === 'chat' && p.threadId === threadIdRef.value
);
```

**Tests:**
```typescript
describe('getActivePaneContext type safety', () => {
    it('should handle missing multi-pane API', () => {
        delete (globalThis as any).__or3MultiPaneApi;
        const result = getActivePaneContext();
        expect(result).toBeNull();
    });
    
    it('should handle malformed pane data', () => {
        (globalThis as any).__or3MultiPaneApi = { panes: { value: [{}] } };
        const result = getActivePaneContext();
        expect(result).toBeNull();
    });
});
```

---

### BLOCKER: Database Message Type Holes

**File:** `app/composables/chat/useAi.ts`

**Lines:** 109, 114, 136-143, 155, 163

```typescript
// Line 109-155
assistantDbMsg: any,
// ...
const existingHashes: string[] | null =
    (assistantDbMsg as any).file_hashes || null;
// ...
...((assistantDbMsg as any).data || {}),
// ...
(assistantDbMsg as any).data?.content ?? '',
(assistantDbMsg as any).data?.reasoning_text ?? '',
// ...
} as any;
```

**Why:**
- Database message shape is completely unknown
- Repeated unsafe access to `.data`, `.file_hashes`, `.data.content`, `.data.reasoning_text`
- Return value cast to `any` propagates type hole
- Any DB schema change will silently break

**Fix:**
```typescript
// Define precise types based on schema
interface AssistantMessageData {
    content?: string;
    reasoning_text?: string;
    tool_calls?: ToolCall[];
}

interface DbAssistantMessage {
    id: string;
    role: 'assistant';
    data: AssistantMessageData;
    file_hashes?: string[] | null;
    deleted?: boolean;
    created_at: number;
}

function buildTailAssistant(
    assistantDbMsg: DbAssistantMessage,
    streamingId?: string
): UiChatMessage {
    const existingHashes: string[] | null = assistantDbMsg.file_hashes ?? null;
    // ... rest with type safety
}
```

**Tests:**
```typescript
describe('buildTailAssistant', () => {
    it('should handle missing data fields gracefully', () => {
        const msg: DbAssistantMessage = {
            id: '123',
            role: 'assistant',
            data: {},
            created_at: Date.now()
        };
        const result = buildTailAssistant(msg);
        expect(result.text).toBe('');
    });
    
    it('should extract file_hashes when present', () => {
        const msg: DbAssistantMessage = {
            id: '123',
            role: 'assistant',
            data: { content: 'hi' },
            file_hashes: ['hash1', 'hash2'],
            created_at: Date.now()
        };
        const result = buildTailAssistant(msg);
        expect(result.fileHashes).toEqual(['hash1', 'hash2']);
    });
});
```

---

### HIGH: Model Input Message Type Loss

**File:** `app/composables/chat/useAi.ts`

**Lines:** 557-559, 585, 606, 615

```typescript
// Line 557-559
const modelInputMessages: any[] = (
    sanitizedEffectiveMessages as any[]
).map((m: any) => ({ ...m }));
```

**Why:**
- Entire message array loses type safety
- Spread operator `{ ...m }` copies unknown shape
- Downstream operations assume shape without checking
- Image detection logic operates on `any[]`

**Fix:**
```typescript
interface ModelInputMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ContentPart[];
    name?: string;
    tool_call_id?: string;
}

const modelInputMessages: ModelInputMessage[] = sanitizedEffectiveMessages.map(
    (m): ModelInputMessage => ({
        role: m.role,
        content: m.content,
        ...(m.name && { name: m.name }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id })
    })
);

// Image detection
const hasImageInput = modelInputMessages.some((m) => 
    Array.isArray(m.content) && 
    m.content.some(p => p.type === 'image_url')
);
```

**Tests:**
```typescript
describe('model input message mapping', () => {
    it('should preserve message structure', () => {
        const input: ChatMessage[] = [{
            id: '1',
            role: 'user',
            content: 'hello',
            created_at: Date.now()
        }];
        const result = mapToModelInput(input);
        expect(result[0]).toHaveProperty('role', 'user');
        expect(result[0]).toHaveProperty('content', 'hello');
    });
});
```

---

### HIGH: Tool Call State Management

**File:** `app/composables/chat/useAi.ts`

**Lines:** 122, 658

```typescript
// Line 122
toolCalls?: any[] | null;

// Line 658
const activeToolCalls = new Map<string, any>();
```

**Why:**
- Tool calls have no defined shape
- Map stores `any` values losing all type information
- Tool execution logic cannot verify structure

**Fix:**
```typescript
// Use existing ToolCall type from imports
interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

// In function signature
toolCalls?: ToolCall[] | null;

// In streaming state
const activeToolCalls = new Map<string, ToolCall>();
```

**Tests:**
```typescript
describe('tool call handling', () => {
    it('should track active tool calls', () => {
        const toolCall: ToolCall = {
            id: 'call_123',
            type: 'function',
            function: { name: 'search', arguments: '{}' }
        };
        activeToolCalls.set(toolCall.id, toolCall);
        expect(activeToolCalls.get('call_123')).toEqual(toolCall);
    });
});
```

---

### MEDIUM: Settings Access Without Types

**File:** `app/composables/chat/useAi.ts`

**Lines:** 251, 263-264, 523

```typescript
// Line 251
const set = (settings && (settings as any).value) || null;

// Line 263-264
(set?.defaultModelMode as any) || 'lastSelected',
fixedModelId: (set?.fixedModelId as any) || null,
```

**Why:**
- Settings object shape unknown
- Fallback values may not match expected types
- Breaking change if settings structure changes

**Fix:**
```typescript
interface ChatSettings {
    defaultModelMode?: 'lastSelected' | 'fixed' | 'always-ask';
    fixedModelId?: string | null;
    masterSystemPrompt?: string | null;
}

// Access safely
const settingsValue = settings?.value as ChatSettings | undefined;
const defaultModelMode = settingsValue?.defaultModelMode ?? 'lastSelected';
const fixedModelId = settingsValue?.fixedModelId ?? null;
```

---

### MEDIUM: Image/File Processing

**File:** `app/composables/chat/useAi.ts`

**Lines:** 359, 361, 364, 468

```typescript
// Line 359-364
Array.isArray((sendMessagesParams as any)?.images)
files = (sendMessagesParams as any).images.map((img: any) => {
    const url = typeof img === 'string' ? img : img?.url || '';
    const provided = typeof img === 'object' ? img?.type : null;
    return { type: inferMimeFromUrl(url, provided), url } as any;
});
```

**Why:**
- `images` array has no type definition
- Elements can be string or object but shape unknown
- Return object cast to `any`

**Fix:**
```typescript
interface ImageInput {
    url: string;
    type?: string;
    status?: 'ready' | 'pending';
}

interface SendMessageParams {
    content: string;
    images?: (string | ImageInput)[];
    files?: FileReference[];
    // ... other fields
}

// Then use
if (Array.isArray(sendMessagesParams.images)) {
    files = sendMessagesParams.images.map((img) => {
        const url = typeof img === 'string' ? img : img?.url || '';
        const provided = typeof img === 'object' ? img?.type : null;
        return { type: inferMimeFromUrl(url, provided), url };
    });
}
```

---

### LOW: Retry Message Type

**File:** `app/composables/chat/useAi.ts`

**Lines:** 1100, 1102, 1112, 1127, 1153

```typescript
// Line 1100-1102
const target: any = await db.messages.get(messageId);
let userMsg: any = target.role === 'user' ? target : null;
```

**Why:**
- Database query returns unknown type
- Role check doesn't narrow type
- Later operations assume structure

**Fix:**
```typescript
interface DbMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    data: Record<string, any>; // Can be narrowed further
    created_at: number;
    deleted?: boolean;
    thread_id: string;
}

const target = await db.messages.get(messageId) as DbMessage | undefined;
if (!target) return;

const userMsg: DbMessage | null = target.role === 'user' ? target : null;
```

---

## Summary Statistics

| Severity | Count | Example Lines |
|----------|-------|---------------|
| BLOCKER  | 15+   | 94, 109, 114, 301, 557-559 |
| HIGH     | 20+   | 122, 251, 263-264, 468, 658 |
| MEDIUM   | 20+   | 359-364, 523, 1100-1102 |
| LOW      | 10+   | Various test helpers |

---

## Recommended Action Plan

1. **Phase 1 (Week 1)**: Define core message types in `types/chat.d.ts`
   - `DbMessage`, `DbUserMessage`, `DbAssistantMessage`
   - `SendMessageParams` with all fields typed
   - `ToolCall` structure (already partially exists)

2. **Phase 2 (Week 2)**: Fix BLOCKER issues
   - Global API access (lines 94, 301)
   - Database message handling (lines 109-155)
   - Add runtime validation with Zod at trust boundaries

3. **Phase 3 (Week 3)**: Fix HIGH severity
   - Model input messages (lines 557-606)
   - Settings access (lines 251, 263-264, 523)
   - Tool call management (lines 122, 658)

4. **Phase 4 (Week 4)**: Fix MEDIUM/LOW and validate
   - File/image processing
   - Retry logic
   - Add comprehensive tests
   - Enable strict TypeScript checks

---

## Impact if Not Fixed

- **Production incidents**: Type mismatches cause crashes
- **Data loss**: Incorrect casts corrupt message data
- **Security risk**: Unvalidated input from external APIs
- **Developer velocity**: Every change requires defensive coding
- **Technical debt**: Compounds as features are added

---

## Files to Create

1. `types/chat.d.ts` - Core chat message types
2. `types/multi-pane.d.ts` - Multi-pane API types
3. `utils/chat/validation.ts` - Zod schemas for runtime validation
4. `app/composables/chat/__tests__/useAi-types.test.ts` - Type safety tests
