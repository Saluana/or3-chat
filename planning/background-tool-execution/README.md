# Background Tool & Workflow Execution - Planning Documents

This folder contains comprehensive planning documentation for implementing tool and workflow execution in OR3 Chat's background streaming system.

## 📋 Document Overview

### [QUICKSTART.md](./QUICKSTART.md) - **Start Here!** ⭐
A fast-path guide for developers to understand the problem and start implementing. Includes:
- 5-minute problem overview
- Core implementation checklist
- Code snippets and examples
- Common pitfalls and debugging tips

**Read this first if you want to start coding immediately.**

---

### [ANALYSIS.md](./ANALYSIS.md) - Root Cause Analysis
Deep dive into why tools don't work in background mode and what needs fixing:
- **Root Cause Analysis:** Why tool calls are ignored (with code evidence)
- **Memory Leak Analysis:** Three critical memory leaks identified
- **Performance Bottleneck Analysis:** SSE broadcasting and database write issues
- **Risk Assessment:** High/medium/low risk areas
- **Success Metrics:** How to measure if the implementation works

**Read this to understand the "why" behind the implementation.**

---

### [requirements.md](./requirements.md) - Feature Requirements
Formal requirements document covering:
- Current state analysis (what works, what's broken)
- 44 detailed requirements organized by feature area
- Acceptance criteria in "WHEN...THEN...SHALL" format
- Non-functional requirements (reliability, performance, compatibility)
- Security and limits

**Read this to understand what the system should do when complete.**

---

### [design.md](./design.md) - Technical Design
Detailed architecture and implementation design:
- System architecture with sequence diagrams
- Core components (Server Tool Registry, Tool Executor, Stream Handler)
- Data models and database schemas
- Memory leak fixes (with code examples)
- Performance optimizations (SSE batching, Convex throttling)
- Workflow integration design
- Error handling strategy
- Testing strategy

**Read this to understand how the system will work internally.**

---

### [tasks.md](./tasks.md) - Implementation Plan
Step-by-step implementation checklist:
- 10 phases with 150+ granular tasks
- Task dependencies and ordering
- Estimated effort (66-92 hours total)
- Success criteria per phase
- Testing requirements

**Read this to understand the implementation roadmap.**

---

## 🚀 How to Use These Documents

### For **Developers** implementing the feature:
1. Start with **QUICKSTART.md** to get coding fast
2. Reference **design.md** for architectural decisions
3. Follow **tasks.md** for step-by-step implementation
4. Refer back to **requirements.md** when writing tests

### For **Reviewers** evaluating the plan:
1. Read **ANALYSIS.md** to understand the problem
2. Review **requirements.md** for scope and completeness
3. Examine **design.md** for technical soundness
4. Check **tasks.md** for realistic effort estimates

### For **Project Managers** tracking progress:
1. Use **tasks.md** as the project checklist
2. Reference **requirements.md** for acceptance criteria
3. Monitor against **ANALYSIS.md** success metrics

---

## 🎯 The Problem in One Sentence

**Tool calls are parsed but ignored in background streaming—this implementation adds tool execution, fixes memory leaks, and optimizes performance.**

---

## 📊 Implementation Summary

### Phases
1. **Server Tool Registry** (8-12h) - Node.js tool execution system
2. **Database Schema** (4-6h) - Extend Convex schema for tool metadata
3. **Tool Execution Engine** (12-16h) - Multi-turn conversation loop
4. **Stream Handler Integration** (6-8h) - Connect executor to background streaming
5. **Memory Leak Fixes** (4-6h) - Fix job viewer cleanup issues
6. **Performance Optimizations** (6-8h) - SSE batching, Convex throttling
7. **Workflow Integration** (8-10h) - Background workflow execution with tools
8. **UI Integration** (4-6h) - Display tool execution in chat
9. **Testing** (10-14h) - Unit, integration, E2E, load tests
10. **Documentation & Monitoring** (4-6h) - Docs, logging, metrics

### Total Effort
**66-92 hours** (~2-3 weeks for one developer)

### Key Deliverables
✅ Tools execute automatically in background mode  
✅ Multi-turn tool conversations work (AI can call tools iteratively)  
✅ Workflows with tool-using agents run in background  
✅ Memory leaks fixed (stable after 100+ jobs)  
✅ SSE performance improved 10x (event count reduction)  
✅ Comprehensive test coverage  
✅ Full documentation  

---

## 🔧 Technical Highlights

### Core Issue
```typescript
// Current (BROKEN):
for await (const evt of parseOpenRouterSSE(stream)) {
    if (evt.type === 'text') {
        fullContent += evt.text;
    }
    // ❌ NO HANDLER for evt.type === 'tool_call'
}

// Fixed:
for await (const evt of parseOpenRouterSSE(stream)) {
    if (evt.type === 'text') {
        fullContent += evt.text;
    } else if (evt.type === 'tool_call') {
        toolCalls.push(evt.tool_call);  // ✅ Accumulate for execution
    }
}

if (toolCalls.length > 0) {
    const result = await executeToolLoop({ ... });  // ✅ Execute tools
    fullContent = result.finalContent;
}
```

### New Components
- **Server Tool Registry** (`server/utils/tools/tool-registry.ts`)
- **Tool Executor** (`server/utils/background-jobs/tool-executor.ts`)
- **Built-in Tools** (`server/plugins/tools/time.ts`, `calculate.ts`)

### Database Changes
- Extend `background_jobs` table with `active_tool_calls`, `tool_rounds`
- Add indexes for performance
- Track tool execution metadata

---

## 📈 Expected Impact

### User Experience
- **Before:** Tool calls fail silently when user navigates away
- **After:** Tool calls execute automatically, user returns to completed response

### System Capabilities
- **Before:** Background streaming = text-only responses
- **After:** Background streaming = full agentic workflows with tool use

### Performance
- **Before:** 100 SSE events per response, memory leaks after 100 jobs
- **After:** 10 SSE events per response, stable memory usage

---

## 📚 Related Documentation

- **OpenRouter Integration:** `docs/openrouter-integration.md`
- **Background Streaming Design:** `planning/background-streaming/design.md`
- **Workflow System:** `docs/workflows/`
- **Tool Registry (Client):** `app/utils/chat/tool-registry.ts`

---

## ✅ Checklist for Starting Development

- [ ] Read QUICKSTART.md (15 minutes)
- [ ] Read ANALYSIS.md (30 minutes)
- [ ] Skim requirements.md and design.md (30 minutes)
- [ ] Set up local environment (Convex dev, OpenRouter API key)
- [ ] Create feature branch: `feature/background-tool-execution`
- [ ] Start with Phase 1: Server Tool Registry
- [ ] Write tests as you implement (TDD approach)
- [ ] Request code review after each phase
- [ ] Update tasks.md with actual time spent vs. estimated

---

## 🤝 Contributing

When implementing this feature:
1. Follow the phase order in tasks.md (dependencies matter!)
2. Write tests alongside implementation (not after)
3. Update this README with any discoveries or changes
4. Request reviews early and often
5. Document any deviations from the design

---

## 📞 Questions?

If you have questions about these planning docs:
1. Check the relevant document's Q&A section (most have one)
2. Review related code files (links provided in each doc)
3. Ask in the team chat or create a discussion issue

---

## 🎉 Let's Build It!

This is a well-scoped, high-impact feature that will unlock powerful agentic capabilities in OR3 Chat. The planning is complete—now it's time to execute.

**Good luck, and happy coding!** 🚀
