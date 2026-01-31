# Background Streaming Integration - Investigation Summary

**Date:** 2026-01-29  
**Investigator:** Razor (Code Review Agent)  
**Status:** Investigation Complete ✅

---

## Executive Summary

The OR3 Chat background streaming system is **90% complete** but has a **critical gap**: tool calls are parsed but never executed. Adding tool execution support requires approximately **66-92 hours** of development work across 10 phases.

### The One-Line Problem
```typescript
// server/utils/background-jobs/stream-handler.ts, line 184
for await (const evt of parseOpenRouterSSE(params.stream)) {
    if (evt.type === 'text') { /* ✅ handled */ }
    // ❌ NO HANDLER for evt.type === 'tool_call'
}
```

---

## What Works Today

✅ **Text Streaming**
- AI responses stream in background when user navigates away
- Client reconnects via SSE (`/api/jobs/[id]/stream`)
- Real-time token updates when viewing active job
- Notifications on completion

✅ **Infrastructure**
- Memory provider (single instance, in-memory)
- Convex provider (multi-instance, persistent)
- SSE broadcasting system with viewer tracking
- Job lifecycle management (create, update, complete, abort, cleanup)

✅ **Parsing**
- Tool calls ARE parsed in `parseOpenRouterSSE()` 
- Emits `{ type: 'tool_call', tool_call: { id, function: { name, arguments } } }`

---

## What Doesn't Work

❌ **Tool Execution**
- Tool calls are silently ignored in background streaming
- No server-side tool registry or execution engine
- No multi-turn conversation loop (LLM → Tool → LLM)
- No tool result accumulation

❌ **Workflow Execution**
- Workflows can only run in foreground (requires active client)
- No background workflow state persistence
- No HITL (human-in-the-loop) handling in background

❌ **Memory Management**
- Job viewer tracking leaks (unbounded `Map`)
- Flush timers not cleaned up on errors
- AbortControllers accumulate in memory provider

❌ **Performance**
- SSE sends event on every text chunk (100+ events per response)
- Missing database indexes for job queries
- No SSE delta batching to multiple clients

---

## Root Causes

### 1. Missing Tool Execution Engine

**Why it doesn't exist:**
- Original design focused on text-only AI chat
- Tool execution was added later for client-side streaming
- Background streaming was implemented **after** tools, without tool support

**What's needed:**
- Server-side tool registry (mirror of client registry)
- Tool execution sandbox (for security)
- Multi-turn conversation loop
- Tool result formatting for LLM context

### 2. Memory Leaks

**Location 1: Job Viewer Tracking**
```typescript
// server/utils/background-jobs/viewers.ts
const jobStreams = new Map<string, Set<(evt: JobStreamEvent) => void>>();
// ❌ Never cleaned up when job completes
```

**Location 2: Flush Timers**
```typescript
// server/utils/background-jobs/stream-handler.ts
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// ❌ Not cleared on error paths
```

**Location 3: AbortControllers**
```typescript
// server/utils/background-jobs/providers/memory.ts
const jobs = new Map<string, MemoryJob>();
// ❌ Jobs with abortControllers stay in map indefinitely
```

### 3. Performance Bottlenecks

**SSE Broadcasting**
- Every text chunk triggers SSE event to all connected clients
- No batching: 1000 chunks = 1000 SSE events

**Database Queries**
- Missing index on `background_jobs.status` (Convex)
- Missing index on `background_jobs.user_id` (Convex)
- Poll queries run every 80ms during active streaming

**Network Overhead**
- SSE keep-alive pings every 15s (needed but expensive at scale)
- No compression on SSE payloads

---

## Bugs Identified

### Blocker Issues

1. **Tool calls silently dropped** (stream-handler.ts:184)
   - Severity: Blocker
   - Impact: Tool-using models fail silently
   - Fix: Add tool execution loop

2. **Memory leak in jobStreams** (viewers.ts:15)
   - Severity: High
   - Impact: Server OOM after 1000+ jobs
   - Fix: Clean up on job completion

3. **Flush timer leak** (stream-handler.ts:132)
   - Severity: High
   - Impact: Timers accumulate on errors
   - Fix: `clearFlushTimer()` in all error paths

### Medium Issues

4. **Missing DB indexes** (convex/schema.ts)
   - Severity: Medium
   - Impact: Slow queries when >100 active jobs
   - Fix: Add indexes on status, user_id

5. **No SSE delta batching** (jobs/[id]/stream.get.ts)
   - Severity: Medium
   - Impact: 100x more events than needed
   - Fix: Batch deltas over 50ms window

6. **AbortController retention** (memory.ts:111)
   - Severity: Low
   - Impact: Slow memory growth
   - Fix: Delete jobs after completedJobRetentionMs

---

## Implementation Plan (10 Phases)

### Phase 1: Server Tool Registry (8-12 hours)
- Create `server/utils/tools/registry.ts`
- Mirror client tool definitions
- Add tool discovery API

### Phase 2: Database Schema (4-6 hours)
- Extend `background_jobs` table with:
  - `tool_calls` field (array of tool call metadata)
  - `conversation_history` field (multi-turn context)
- Add indexes on status, user_id

### Phase 3: Tool Execution Engine (12-16 hours)
- Create `server/utils/tools/executor.ts`
- Implement multi-turn loop (LLM → Tool → LLM)
- Add tool result formatting

### Phase 4: Stream Handler Integration (6-8 hours)
- Add `tool_call` event handler in consumeBackgroundStream
- Integrate tool executor
- Update job storage with tool metadata

### Phase 5: Memory Leak Fixes (4-6 hours)
- Clean up jobStreams on job completion
- Clear flush timers in all error paths
- Delete old jobs from memory provider

### Phase 6: Performance Optimizations (6-8 hours)
- Add SSE delta batching (50ms window)
- Add database indexes
- Implement SSE payload compression

### Phase 7: Workflow Integration (8-10 hours)
- Extend workflow executor for background mode
- Add workflow state persistence
- Handle HITL requests in background

### Phase 8: UI Integration (4-6 hours)
- Display tool execution status in UI
- Show workflow progress in background
- Add tool call history in message view

### Phase 9: Testing (10-14 hours)
- Unit tests for tool executor
- Integration tests for full tool loop
- E2E tests for background workflows
- Load tests for memory stability

### Phase 10: Documentation (4-6 hours)
- Update hook documentation
- Add tool execution guide
- Performance tuning guide

**Total: 66-92 hours (2-3 weeks)**

---

## Detailed Planning Documents

All planning documents are located in:
```
planning/background-tool-execution/
```

### Quick Start (Choose Your Path)

**Path 1: Developer (Want to Code Fast)**
1. Read `QUICKSTART.md` (15 min)
2. Read `design.md` sections 1-3 (20 min)
3. Read `tasks.md` Phase 1 (10 min)
4. Start implementing!

**Path 2: Architect (Need Full Picture)**
1. Read `README.md` (10 min)
2. Read `ARCHITECTURE.md` (30 min)
3. Read `design.md` (45 min)
4. Read `tasks.md` (30 min)
5. Start planning!

**Path 3: Manager (Need Estimates)**
1. Read this document (5 min)
2. Read `requirements.md` (20 min)
3. Read `tasks.md` (15 min)
4. Review with team!

### Document Map

| Document | Purpose | Time to Read |
|----------|---------|--------------|
| **INDEX.md** | Navigation hub | 5 min |
| **README.md** | Central overview | 10 min |
| **QUICKSTART.md** | Fast developer path | 15 min |
| **ANALYSIS.md** | Deep technical analysis | 45 min |
| **requirements.md** | Formal requirements (44) | 20 min |
| **design.md** | Technical architecture | 45 min |
| **tasks.md** | Granular task list (150+) | 30 min |
| **ARCHITECTURE.md** | Visual diagrams | 30 min |

---

## Recommendations

### Immediate Actions (Week 1)

1. **Fix Memory Leaks** (Phase 5)
   - Critical for production stability
   - Low risk, high impact
   - Can be done independently

2. **Add Database Indexes** (Phase 2)
   - Improves query performance
   - Zero risk, medium impact
   - Takes 2-4 hours

3. **Start Tool Registry** (Phase 1)
   - Foundation for all tool work
   - Must be done first
   - 8-12 hours

### Medium Term (Weeks 2-3)

4. **Tool Execution Engine** (Phase 3)
   - Core feature enablement
   - High complexity, high value
   - 12-16 hours

5. **Stream Handler Integration** (Phase 4)
   - Connect everything
   - Medium complexity
   - 6-8 hours

6. **Performance Optimizations** (Phase 6)
   - SSE batching, compression
   - Medium impact, low risk
   - 6-8 hours

### Long Term (Week 4+)

7. **Workflow Integration** (Phase 7)
   - Advanced feature
   - High value for power users
   - 8-10 hours

8. **UI Integration** (Phase 8)
   - Polish and UX
   - Medium impact
   - 4-6 hours

### Testing Throughout

9. **Continuous Testing** (Phase 9)
   - Write tests alongside code
   - Don't save for the end
   - 10-14 hours total

---

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tool execution security | High | High | Sandbox with resource limits |
| Memory leaks persist | Medium | High | Comprehensive leak tests |
| SSE scalability issues | Medium | Medium | Load testing, batching |
| Workflow state corruption | Low | High | Transaction-safe updates |

### Project Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scope creep | High | Medium | Stick to 10 phases |
| Breaking changes | Medium | High | Feature flags, gradual rollout |
| Performance regression | Medium | Medium | Benchmark before/after |
| Incomplete testing | High | High | TDD approach, 80% coverage |

---

## Success Metrics

### Functional Metrics
- ✅ Tool calls execute successfully in background
- ✅ Workflows complete without user presence
- ✅ Multi-turn conversations work (LLM → Tool → LLM)

### Performance Metrics
- 📊 Memory stable after 1000 jobs (no leaks)
- 📊 SSE events reduced 10x (batching)
- 📊 Job queries <50ms (with indexes)

### Quality Metrics
- 🧪 80% test coverage
- 🧪 Zero memory leaks in load tests
- 🧪 All acceptance criteria pass

---

## Conclusion

The OR3 Chat background streaming system is **architecturally sound** but **functionally incomplete**. The infrastructure exists to support tool and workflow execution—we just need to wire it up.

**The good news:** Most code is already written. We're extending, not rebuilding.

**The work ahead:** 
- Add tool execution engine (the missing piece)
- Fix memory leaks (stability)
- Optimize SSE (performance)
- Integrate workflows (advanced feature)

**Estimated effort:** 66-92 hours over 2-3 weeks

**Next step:** Review planning documents with team, then start Phase 1 (Server Tool Registry).

---

## Contact

For questions about this investigation:
- Review planning docs in `planning/background-tool-execution/`
- Start with `INDEX.md` or `README.md`
- Follow `QUICKSTART.md` for fast path

**Investigation complete. Planning documents ready. Ready to implement? Let's go! 🚀**
