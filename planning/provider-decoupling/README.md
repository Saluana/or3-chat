# Provider Decoupling - Documentation Index

This directory contains all planning and implementation documentation for decoupling authentication (Clerk) and sync/storage (Convex) providers from the OR3 Chat core codebase.

## Document Guide

### 📋 Start Here

**[QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md)** - **PRIMARY IMPLEMENTATION GUIDE**
- Detailed step-by-step instructions
- Exact order of operations with dependencies
- Code examples for every registry and adapter
- Complete file lists (create/modify/delete)
- Gotchas, testing strategies, and rollback procedures
- **Start here for implementation**

**[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** - **EXECUTIVE SUMMARY**
- High-level phase overview
- Timeline and deliverables
- Quick reference for project managers

### 📖 Background & Design

**[requirements.md](./requirements.md)** - **REQUIREMENTS SPECIFICATION**
- Defines "decoupled" (build-time vs runtime)
- Lists auto-included "hot zones" in Nuxt
- Acceptance criteria for each surface (auth, sync, storage, workspace)
- Non-functional requirements (simplicity, performance)

**[design.md](./design.md)** - **TECHNICAL DESIGN**
- Why dynamic imports aren't enough in Nuxt/Vite
- Current coupling hotspots (exact file list)
- Chosen architecture (registries + adapters + Nuxt modules)
- Core contracts for each surface
- Example providers (LocalFS, SQLite)
- Testing strategy

**[tasks.md](./tasks.md)** - **TASK CHECKLIST**
- Phase-by-phase task breakdown
- Each task mapped to requirements
- Organized for tracking progress

**[implementation-guide.md](./implementation-guide.md)** - **DETAILED CODE SKETCHES**
- Provider module structure
- Registration patterns
- Wizard integration approach
- Verification checklist

### 📝 Additional Notes

**[intern-notes.md](./intern-notes.md)** - **CONTEXT & RATIONALE**
- Historical context
- Why certain approaches were chosen
- Lessons learned

**[dumb-issues.md](./dumb-issues.md)** - **KNOWN ISSUES & EDGE CASES**
- Common pitfalls
- Nuxt/Vite gotchas
- Debugging tips

---

## Quick Implementation Checklist

Follow this order:

### Phase 0: Setup (Days 1-2)
- [ ] Create provider package directories
- [ ] Create `or3.providers.generated.ts`
- [ ] Update `nuxt.config.ts`
- [ ] Audit current coupling

### Phase 1: Registries (Days 3-5)
- [ ] AuthWorkspaceStore registry
- [ ] ProviderTokenBroker registry
- [ ] SyncGatewayAdapter registry
- [ ] StorageGatewayAdapter registry
- [ ] WorkspaceApi interface

### Phase 2: Refactor Core (Days 6-9)
- [ ] Session → AuthWorkspaceStore
- [ ] Token minting → ProviderTokenBroker
- [ ] Sync endpoints → SyncGatewayAdapter
- [ ] Storage endpoints → StorageGatewayAdapter
- [ ] Workspace endpoints (new)
- [ ] Workspace UI → WorkspaceApi
- [ ] Client plugins (gateway mode)
- [ ] Handle test pages

### Phase 3: Provider Packages (Days 10-14)
- [ ] Clerk provider package
- [ ] Convex provider package (server)
- [ ] Convex provider package (client)
- [ ] LocalFS provider package (example)

### Phase 4: Cleanup & Verification (Days 15-17)
- [ ] Delete provider code from core
- [ ] Remove provider dependencies
- [ ] Update config schemas
- [ ] Build matrix verification
- [ ] Functional verification

### Phase 5: Documentation (Days 18-19)
- [ ] Provider system docs
- [ ] Creating a provider guide
- [ ] Provider package READMEs
- [ ] Migration guide

---

## Key Principles

1. **Registries = contracts**: Core owns interfaces, providers implement
2. **No SDK imports in hot zones**: Auto-included Nuxt directories must be provider-agnostic
3. **Nuxt modules for providers**: Only way to make dependencies truly optional
4. **Dispatch, don't import**: Core endpoints dispatch to registered adapters
5. **Install-time selection**: Wizard installs providers, writes config, rebuilds

---

## Success Criteria

✅ Core builds without `@clerk/nuxt` installed  
✅ Core builds without `convex*` packages installed  
✅ No provider imports in auto-included zones  
✅ Default stack behavior unchanged  
✅ New providers can be added without editing core  

---

## Timeline

**Estimated**: 13-19 days (2-4 weeks)  
**Optimistic**: 10-14 days with parallel work  

---

## Getting Started

1. Read [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md) in full
2. Review [requirements.md](./requirements.md) for acceptance criteria
3. Reference [design.md](./design.md) for technical decisions
4. Follow phase-by-phase implementation from guide
5. Use [tasks.md](./tasks.md) to track progress

---

## Questions?

- **"Why can't we just use dynamic imports?"** → See requirements.md "Runtime gating" section
- **"What's an auto-included zone?"** → See requirements.md "Build-graph hot zones" section
- **"How do registries work?"** → See QUICK_START_GUIDE.md "Quick Reference - Registry Pattern"
- **"What files need to change?"** → See QUICK_START_GUIDE.md file lists
- **"What's the exact order?"** → See QUICK_START_GUIDE.md "Implementation Order"

---

**Status**: Ready for implementation  
**Last Updated**: 2024-02-04  
**Primary Contact**: [Your name/team]

