# Background Tool Execution - Quick Start Guide

This guide provides a fast path to understanding and implementing background tool execution in OR3 Chat.

## The 5-Minute Overview

### What's Broken?
Tool calls are **parsed but ignored** in background streaming. When a user navigates away from a chat using tools (like "What time is it?"), the AI's tool calls are received but never executed.

**Problem Code:**
```typescript
// server/utils/background-jobs/stream-handler.ts, line 184
for await (const evt of parseOpenRouterSSE(params.stream)) {
    if (evt.type === 'text') {
        // ✅ Text is handled
        fullContent += evt.text;
    }
    // ❌ NO HANDLER for evt.type === 'tool_call'
}
```

### What Needs to Happen?
1. **Add tool_call handler** in the stream loop
2. **Execute tools** using a server-side tool registry
3. **Resume streaming** with tool results until the conversation completes

### Key Files to Understand
- `server/utils/background-jobs/stream-handler.ts` - Background streaming orchestrator
- `shared/openrouter/parseOpenRouterSSE.ts` - SSE parser (already works!)
- `app/composables/chat/useAi.ts` - Client-side tool execution (reference implementation)
- `app/utils/chat/tool-registry.ts` - Client tool registry (Vue-based, can't use server-side)

---

## Implementation Checklist

### Step 1: Create Server Tool Registry (Start Here!)
**File:** `server/utils/tools/tool-registry.ts` (new)

**Core Interface:**
```typescript
export type ServerToolHandler = (
    args: Record<string, unknown>,
    context: { userId: string; threadId: string; jobId: string }
) => Promise<string> | string;

export interface ServerToolDefinition {
    name: string;
    function: {
        name: string;
        description: string;
        parameters: { type: 'object'; properties: Record<string, unknown> };
    };
    handler: ServerToolHandler;
    timeoutMs?: number; // Default: 10000
}

const tools = new Map<string, ServerToolDefinition>();

export function registerTool(def: ServerToolDefinition) {
    tools.set(def.name, def);
}

export async function executeTool(
    name: string, 
    argsJson: string,
    context: { userId: string; threadId: string; jobId: string }
): Promise<{ result: string | null; error?: string }> {
    const tool = tools.get(name);
    if (!tool) return { result: null, error: `Tool "${name}" not found` };
    
    // Parse args, validate, execute with timeout
    const args = JSON.parse(argsJson);
    const result = await tool.handler(args, context);
    return { result };
}

export function getEnabledDefinitions() {
    return Array.from(tools.values()).map(t => t.function);
}
```

**Test it:**
```typescript
// server/plugins/tools/time.ts
registerTool({
    name: 'get_current_time',
    function: {
        name: 'get_current_time',
        description: 'Get the current time',
        parameters: { type: 'object', properties: {} },
    },
    handler: async () => new Date().toISOString(),
});
```

---

### Step 2: Extend Database Schema
**File:** `convex/schema.ts`

Add to `background_jobs` table:
```typescript
active_tool_calls: v.optional(v.array(v.object({
    id: v.string(),
    name: v.string(),
    status: v.string(), // 'pending' | 'running' | 'completed' | 'error'
    started_at: v.optional(v.number()),
    finished_at: v.optional(v.number()),
    error: v.optional(v.string()),
}))),
tool_rounds: v.optional(v.array(v.object({
    round: v.number(),
    tool_calls: v.array(v.object({
        id: v.string(),
        name: v.string(),
        result: v.string(),
        error: v.optional(v.string()),
    })),
}))),
```

**File:** `server/utils/background-jobs/types.ts`

Extend `BackgroundJob`:
```typescript
export interface BackgroundJob {
    // ... existing fields
    activeToolCalls?: Array<{ id: string; name: string; status: string; ... }>;
    toolRounds?: Array<{ round: number; toolCalls: [...] }>;
}
```

---

### Step 3: Create Tool Execution Loop
**File:** `server/utils/background-jobs/tool-executor.ts` (new)

**Core Logic:**
```typescript
export async function executeToolLoop(params: {
    jobId: string;
    messages: ORMessage[]; // Initial conversation
    model: string;
    apiKey: string;
    userId: string;
    threadId: string;
    provider: BackgroundJobProvider;
}): Promise<{ finalContent: string; totalRounds: number }> {
    const { messages, model, apiKey, userId, threadId, jobId, provider } = params;
    const MAX_ROUNDS = 10;
    let round = 0;
    
    while (round < MAX_ROUNDS) {
        // 1. Stream from OpenRouter with current messages
        const response = await streamSingleRound(messages, model, apiKey);
        
        if (response.finishReason === 'stop') {
            // Done! Return final content
            return { finalContent: response.content, totalRounds: round };
        }
        
        if (response.finishReason === 'tool_calls') {
            // 2. Execute all tool calls
            const toolResults = [];
            for (const toolCall of response.toolCalls) {
                const result = await executeTool(
                    toolCall.function.name,
                    toolCall.function.arguments,
                    { userId, threadId, jobId }
                );
                toolResults.push({ call: toolCall, result: result.result || result.error });
            }
            
            // 3. Append tool results to conversation
            messages.push({
                role: 'assistant',
                tool_calls: response.toolCalls,
            });
            for (const { call, result } of toolResults) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    name: call.function.name,
                    content: result,
                });
            }
            
            // 4. Continue loop
            round++;
        }
    }
    
    throw new Error('Tool execution limit exceeded');
}

async function streamSingleRound(
    messages: ORMessage[],
    model: string,
    apiKey: string
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages,
            tools: getEnabledDefinitions(),
            tool_choice: 'auto',
            stream: true,
        }),
    });
    
    let content = '';
    const toolCalls: ToolCall[] = [];
    let finishReason = 'stop';
    
    for await (const evt of parseOpenRouterSSE(response.body)) {
        if (evt.type === 'text') content += evt.text;
        if (evt.type === 'tool_call') toolCalls.push(evt.tool_call);
        // Note: finish_reason comes in the last chunk, extract it separately
    }
    
    return { content, toolCalls, finishReason };
}
```

---

### Step 4: Integrate with Stream Handler
**File:** `server/utils/background-jobs/stream-handler.ts`

**Modify `consumeBackgroundStream`:**
```typescript
import { executeToolLoop } from './tool-executor';

export async function consumeBackgroundStream(params: {
    jobId: string;
    stream: ReadableStream<Uint8Array>;
    context: BackgroundStreamParams;
    provider: BackgroundJobProvider;
    // ... other params
}): Promise<void> {
    let fullContent = '';
    const toolCalls: ToolCall[] = [];
    
    // Parse initial stream
    for await (const evt of parseOpenRouterSSE(params.stream)) {
        if (evt.type === 'text') {
            fullContent += evt.text;
            // ... existing text handling
        } else if (evt.type === 'tool_call') {
            // NEW: Accumulate tool calls
            toolCalls.push(evt.tool_call);
        }
    }
    
    // NEW: If tool calls detected, execute tool loop
    if (toolCalls.length > 0) {
        const messages = buildInitialMessages(params.context);
        const loopResult = await executeToolLoop({
            jobId: params.jobId,
            messages,
            model: params.context.body.model as string,
            apiKey: params.apiKey,
            userId: params.userId,
            threadId: params.threadId,
            provider: params.provider,
        });
        
        fullContent = loopResult.finalContent;
    }
    
    // Complete job with final content
    await params.provider.completeJob(params.jobId, fullContent);
}

function buildInitialMessages(context: BackgroundStreamParams): ORMessage[] {
    // Extract messages from context.body.messages
    return context.body.messages as ORMessage[];
}
```

---

### Step 5: Test It!

**Unit Test:**
```typescript
// server/utils/background-jobs/__tests__/tool-executor.test.ts
import { executeToolLoop } from '../tool-executor';
import { registerTool } from '~/server/utils/tools/tool-registry';

describe('executeToolLoop', () => {
    it('executes tool and resumes conversation', async () => {
        // Register test tool
        registerTool({
            name: 'test_tool',
            function: { name: 'test_tool', description: 'Test', parameters: { type: 'object' } },
            handler: async () => 'Tool result!',
        });
        
        // Mock OpenRouter response
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                body: mockSSEStream([
                    { type: 'tool_call', tool_call: { id: '1', function: { name: 'test_tool', arguments: '{}' } } },
                ]),
            })
            .mockResolvedValueOnce({
                ok: true,
                body: mockSSEStream([
                    { type: 'text', text: 'Final response' },
                ]),
            });
        
        const result = await executeToolLoop({
            jobId: 'test',
            messages: [{ role: 'user', content: 'Test' }],
            model: 'gpt-4',
            apiKey: 'test',
            userId: 'user1',
            threadId: 'thread1',
            provider: mockProvider,
        });
        
        expect(result.finalContent).toBe('Final response');
        expect(result.totalRounds).toBe(1);
    });
});
```

**Integration Test:**
```typescript
// Start background job with tool call
const { jobId } = await startBackgroundStream({
    body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What time is it?' }],
        tools: [{ name: 'get_current_time', ... }],
    },
    apiKey: 'test',
    userId: 'user1',
    threadId: 'thread1',
    messageId: 'msg1',
});

// Wait for completion
await waitForJobCompletion(jobId);

// Verify job has tool execution metadata
const job = await provider.getJob(jobId, 'user1');
expect(job.status).toBe('complete');
expect(job.toolRounds).toHaveLength(1);
expect(job.toolRounds[0].toolCalls[0].name).toBe('get_current_time');
```

---

## Common Pitfalls

### 1. Tool Timeouts
**Problem:** Tool executes forever, blocking the job.
**Solution:** Enforce timeout in `executeTool()`:
```typescript
export async function executeTool(...) {
    const timeoutMs = tool.timeoutMs || 10000;
    const result = await Promise.race([
        tool.handler(args, context),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), timeoutMs)
        ),
    ]);
    return { result };
}
```

### 2. Infinite Tool Loops
**Problem:** Model keeps calling tools, never returns `finish_reason: 'stop'`.
**Solution:** Enforce max rounds (10) in `executeToolLoop()`:
```typescript
if (round >= MAX_ROUNDS) {
    throw new Error('Tool execution limit exceeded');
}
```

### 3. Tool Errors Crash Job
**Problem:** Tool throws error, job fails.
**Solution:** Catch errors, pass to model:
```typescript
try {
    const result = await tool.handler(args, context);
    return { result };
} catch (error) {
    return { result: null, error: error.message };
}
```

### 4. Memory Leaks
**Problem:** `jobStreams` Map grows unbounded.
**Solution:** Clean up on zero viewers (see Phase 5 in tasks.md):
```typescript
if (state.listeners.size === 0 && state.status !== 'streaming') {
    jobStreams.delete(jobId);
}
```

---

## Debugging Tips

### Enable Debug Logging
```typescript
// server/utils/background-jobs/tool-executor.ts
const DEBUG = process.env.DEBUG_TOOLS === 'true';

if (DEBUG) {
    console.log('[tool-executor] Starting round', round);
    console.log('[tool-executor] Tool calls:', toolCalls.map(t => t.function.name));
    console.log('[tool-executor] Tool results:', toolResults);
}
```

### Inspect Job State
```bash
# Get job status
curl http://localhost:3000/api/jobs/{jobId}/status

# Stream SSE events
curl http://localhost:3000/api/jobs/{jobId}/stream
```

### Check Convex Database
```bash
# View background jobs
npx convex dev
# In Convex dashboard, query: db.query('background_jobs').collect()
```

---

## Quick Reference

### Key Concepts
- **Tool Registry:** Map of tool name → handler function
- **Tool Execution Loop:** Multi-turn conversation until `finish_reason === 'stop'`
- **Job Provider:** Storage backend (memory or Convex)
- **SSE Streaming:** Real-time updates to clients

### File Structure
```
server/
├── utils/
│   ├── tools/
│   │   ├── tool-registry.ts (NEW - server tool registry)
│   │   └── __tests__/
│   └── background-jobs/
│       ├── tool-executor.ts (NEW - tool execution loop)
│       ├── stream-handler.ts (MODIFY - add tool_call handler)
│       ├── types.ts (MODIFY - extend BackgroundJob)
│       └── __tests__/
└── plugins/
    └── tools/ (NEW)
        ├── time.ts (built-in tool)
        └── calculate.ts (built-in tool)

convex/
└── schema.ts (MODIFY - add tool fields)

app/
└── components/
    └── chat/
        └── ChatMessage.vue (MODIFY - display tool indicators)
```

### Environment Setup
```bash
# Install dependencies
npm install

# Start Convex dev
npx convex dev

# Start Nuxt dev server
npm run dev

# Run tests
npm test -- --grep "tool-executor"
```

---

## Next Steps

1. ✅ Read this guide
2. ⬜ Read `ANALYSIS.md` for detailed root cause analysis
3. ⬜ Read `requirements.md` for full feature requirements
4. ⬜ Read `design.md` for architecture and data models
5. ⬜ Read `tasks.md` for step-by-step implementation tasks
6. ⬜ Start with **Phase 1: Server Tool Registry** (8-12 hours)
7. ⬜ Iterate with testing (don't skip tests!)
8. ⬜ Request code review after Phase 1
9. ⬜ Continue to Phase 2-4 (core functionality)
10. ⬜ Ship it! 🚀

---

## Questions?

- **"Why not use client tool registry?"** → It's Vue-specific and browser-dependent. Server needs Node.js-compatible version.
- **"What if a tool needs secrets?"** → Pass via `ToolExecutionContext`, load from env vars server-side.
- **"How do I add a new tool?"** → Create `server/plugins/tools/{name}.ts`, call `registerTool()`.
- **"What if tool execution fails?"** → Error is passed to the model as a tool result, not a job failure.
- **"How do I test locally?"** → Use memory provider, mock OpenRouter responses in tests.

Good luck! 🎯
