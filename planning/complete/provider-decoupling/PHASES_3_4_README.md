# Phase 3 & 4 Planning - Quick Reference

**Created**: 2026-02-04  
**Status**: Planning Complete, Ready for Implementation  
**Review**: Neckbeard Review Applied ✅  

---

## Overview

This directory now contains **complete implementation plans** for Phase 3 (Provider Package Extraction) and Phase 4 (Additional Refinements).

Both phases build on the completed Phase 1 & 2 work (core registries and refactoring).

---

## Files in This Directory

### Main Task Lists

1. **[PHASE_3_TASKS.md](./PHASE_3_TASKS.md)** (14.9KB)
   - **Time**: 3-5 days
   - **Goal**: Extract provider implementations into optional npm packages
   - **Sections**:
     - 3.1: Create or3-provider-convex package
     - 3.2: Create or3-provider-clerk package
     - 3.3: Update root package configuration
     - 3.4: Create provider installation wizard
     - 3.5: Verification & testing

2. **[PHASE_4_TASKS.md](./PHASE_4_TASKS.md)** (17.2KB)
   - **Time**: 2-3 days
   - **Goal**: Polish and complete remaining features
   - **Sections**:
     - 4.1: Workspace SSR endpoints
     - 4.2: Client plugin cleanup
     - 4.3: Test page refactoring
     - 4.4: Final verification & optimization
     - 4.5: Optional refinements

3. **[dumb-issues.md](./dumb-issues.md)** (Updated)
   - **Critical Issues**: 19 new issues added from neckbeard review
   - **Categories**: Build errors, security holes, architectural problems, planning issues
   - **Purpose**: Document all problems found during review

### Supporting Documentation

- **[FINAL_STATUS.md](./FINAL_STATUS.md)** - Phase 1 & 2 completion status
- **[PROGRESS_SUMMARY.md](./PROGRESS_SUMMARY.md)** - Detailed progress tracking
- **[README.md](./README.md)** - Overall navigation guide
- **[QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md)** - Implementation guide for completed phases
- **[tasks.md](./tasks.md)** - Original master checklist

---

## How to Use These Task Lists

### For Implementers

1. **Start with Phase 3** if you want provider packages, or **skip to Phase 4** if you want to complete features first
2. **Read dumb-issues.md** BEFORE implementing - it documents critical errors in the task lists
3. **Follow each task sequentially** - they're ordered for a reason
4. **Test after each section** - don't wait until the end
5. **Update the checklist** - Mark items complete as you go

### For Reviewers

1. **Check dumb-issues.md** - See what problems were found
2. **Review task structure** - Ensure implementer can follow it
3. **Verify code examples** - Make sure they're correct
4. **Challenge time estimates** - Current estimates may be 2-3x off
5. **Check success criteria** - Are they realistic and testable?

---

## Phase 3 Summary

**Goal**: Extract provider implementations to separate packages

### What You'll Build

```
packages/
├── or3-provider-convex/
│   ├── src/
│   │   ├── auth-workspace-store.ts
│   │   ├── sync-gateway-adapter.ts
│   │   ├── storage-gateway-adapter.ts
│   │   ├── server-plugin.ts
│   │   ├── nuxt.ts (Nuxt module)
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
└── or3-provider-clerk/
    ├── src/
    │   ├── token-broker.ts
    │   ├── server-plugin.ts
    │   ├── nuxt.ts (Nuxt module)
    │   └── index.ts
    ├── package.json
    └── tsconfig.json
```

### Key Changes

- **Move** adapters from `server/*/impls/` to packages
- **Delete** `server/plugins/00.register-providers.ts`
- **Create** Nuxt modules for each provider
- **Update** root `nuxt.config.ts` to conditionally load providers
- **Configure** Bun workspaces in root `package.json`

### Success Criteria

- ✅ Core builds without any providers installed
- ✅ Core builds with only Convex installed
- ✅ Core builds with all providers installed
- ✅ All typechecks pass in all scenarios
- ✅ Provider packages are properly typed
- ✅ No provider SDK imports in core code

---

## Phase 4 Summary

**Goal**: Complete remaining features and polish

### What You'll Build

1. **Workspace SSR Endpoints** (`server/api/workspaces/*`):
   - `list.get.ts` - List user's workspaces
   - `create.post.ts` - Create new workspace
   - `[id]/update.patch.ts` - Update workspace
   - `[id]/delete.delete.ts` - Delete workspace
   - `active/get.get.ts` - Get active workspace
   - `active/set.post.ts` - Set active workspace

2. **Extended AuthWorkspaceStore**:
   - CRUD methods for workspaces
   - Active workspace tracking
   - Membership management

3. **Client Plugin Updates**:
   - Gate provider-specific plugins
   - Refactor to use composables
   - Remove direct provider imports

4. **Test Page Cleanup**:
   - Gate or move provider-specific tests
   - Update test navigation
   - Add appropriate error messages

### Key Changes

- **Extend** `AuthWorkspaceStore` interface with CRUD methods
- **Implement** workspace endpoints using registry pattern
- **Update** `GatewayWorkspaceApi` to call new endpoints
- **Gate** or move client plugins with provider dependencies
- **Clean up** test pages that import providers

### Success Criteria

- ✅ Workspace CRUD works via SSR endpoints
- ✅ Client plugins are provider-agnostic or gated
- ✅ Test pages work with and without providers
- ✅ All typechecks pass
- ✅ Bundle size is optimized
- ✅ End-to-end tests pass

---

## Critical Issues from Neckbeard Review

**Read dumb-issues.md for full details.** Here are the top issues:

### Build Breakers (Fix Before Implementing)

1. **Issue #17**: Bun build command doesn't generate type declarations
   - Fix: Use `tsc --emitDeclarationOnly` after build

2. **Issue #27**: `require()` in ESM Nuxt 4 will crash
   - Fix: Use dynamic `import()` or Nitro plugin pattern

3. **Issue #28**: `require.resolve()` in browser code is undefined
   - Fix: Use build-time feature detection or runtime flag

4. **Issue #32**: `workspace:*` protocol is pnpm-only
   - Fix: Use `link:packages/or3-provider-convex` for Bun

### Security Holes (Fix During Implementation)

5. **Issue #26**: Seven TODO comments instead of authorization checks
   - Fix: Implement actual permission checks using workspace role
   - Consequences: Anyone can delete anyone's workspace without this

### Architectural Problems (Rethink Before Coding)

6. **Issue #18**: Clerk API method `getUserOauthAccessToken` doesn't exist
   - Fix: Use correct Clerk session JWT methods or custom template

7. **Issue #25**: Duplicate type systems (AuthWorkspaceStore vs WorkspaceApi)
   - Fix: Choose one source of truth, probably AuthWorkspaceStore

8. **Issue #20**: Tilde imports (`~/`) break when package used outside monorepo
   - Fix: Use relative imports in packages, only use `~/` in core

### Planning Issues (Adjust Expectations)

9. **Issue #29**: Time estimates are 200-300% too low
   - Listed: 19-27 hours total
   - Reality: 46-60+ hours (1-2 weeks)
   - Reason: Doesn't account for debugging, security, testing

10. **Issue #30**: Claims endpoints are "optional" but code crashes without them
    - Fix: Either make them truly optional with fallbacks, or mark as required

---

## Time Estimates (Realistic)

### Phase 3: Provider Package Extraction

**Original Estimate**: 3-5 days (19-27 hours)  
**Realistic Estimate**: 5-7 days (40-56 hours)  

**Why the difference?**
- Debugging Bun workspace issues: +8-12 hours
- Fixing ESM/require conflicts: +4-6 hours
- Writing proper type declarations: +3-4 hours
- Testing all provider combinations: +6-8 hours

### Phase 4: Additional Refinements

**Original Estimate**: 2-3 days (12-19 hours)  
**Realistic Estimate**: 3-4 days (24-32 hours)  

**Why the difference?**
- Implementing authorization checks: +4-6 hours (not in original)
- Fixing duplicate type systems: +2-3 hours
- Proper error handling: +3-4 hours
- End-to-end testing: +3-4 hours

### Combined Total

**Original**: 5-8 days  
**Realistic**: 8-11 days  
**Conservative (safe)**: 2-3 weeks  

---

## Prerequisites

Before starting Phase 3 or 4:

### Phase 3 Prerequisites

- ✅ Phase 1 complete (all registries created)
- ✅ Phase 2 complete (all endpoints refactored)
- ✅ Bun installed and working
- ✅ Understanding of Nuxt modules
- ✅ Read dumb-issues.md issues #17-23

### Phase 4 Prerequisites

- ✅ Phase 1 complete (all registries created)
- ✅ Phase 2 complete (all endpoints refactored)
- ⚠️ Phase 3 optional (affects plugin strategy)
- ✅ Understanding of Nitro event handlers
- ✅ Read dumb-issues.md issues #24-35

---

## Rollback Strategy

### If Phase 3 Fails

1. Keep temporary implementations in `server/*/impls/`
2. Keep `server/plugins/00.register-providers.ts`
3. Don't delete old code until new packages work
4. Document what blocked completion in dumb-issues.md

**Fallback**: Phase 2 implementation works perfectly as-is

### If Phase 4 Fails

1. Workspace endpoints can be added later (not critical)
2. Plugin gating can be done incrementally
3. Test pages can remain as-is
4. Focus on what's blocking production deployment

**Fallback**: Current implementation is production-ready

---

## Common Pitfalls

### During Implementation

1. **Don't use `require()` in ESM** - Nuxt 4 is ESM-only, use dynamic `import()`
2. **Don't use tilde imports in packages** - Use relative paths only
3. **Don't skip authorization checks** - Implement them properly from the start
4. **Don't trust time estimates** - Add 100% buffer for debugging
5. **Don't delete old code early** - Keep it until new code is verified

### During Testing

1. **Test without providers first** - Catch import errors early
2. **Test each provider combination** - Don't assume they're independent
3. **Test build output, not dev mode** - Dev mode hides module issues
4. **Test in production mode** - SSR behavior differs from dev
5. **Test on a clean machine** - Your dev machine might have cached state

---

## Getting Help

### When Stuck

1. **Check dumb-issues.md** - See if your issue is already documented
2. **Re-read the task section** - You might have missed a step
3. **Look at Phase 1/2 code** - Similar patterns already work
4. **Simplify first** - Get basic version working, then add features
5. **Ask specific questions** - "X doesn't work" → "X fails with Y error when Z"

### What to Document

If you encounter issues:

1. **Add to dumb-issues.md** - Help the next person
2. **Update time estimates** - Track actual vs planned
3. **Note dependencies** - What wasn't obvious from the task list?
4. **Document workarounds** - What did you do instead?
5. **Update success criteria** - What couldn't be achieved and why?

---

## Success Indicators

### You're on Track If...

- ✅ Typechecks pass after each task section
- ✅ Dev server starts without errors
- ✅ Core functionality still works
- ✅ You're documenting issues as you find them
- ✅ Time spent is close to estimates (±50%)

### You're Off Track If...

- ❌ Multiple typechecks fail
- ❌ Dev server won't start
- ❌ Core features broke
- ❌ Time spent is 2x+ estimates
- ❌ You're fighting the framework

**When off track**: Stop, document blockers, ask for help

---

## Post-Implementation

After completing Phase 3 and/or 4:

### Update These Files

- [ ] `FINAL_STATUS.md` - Add Phase 3/4 completion status
- [ ] `PROGRESS_SUMMARY.md` - Update with actual time spent
- [ ] `dumb-issues.md` - Add any new issues found
- [ ] `README.md` - Update phase completion status
- [ ] `IMPLEMENTATION_COMPLETE.md` - Add Phase 3/4 sections

### Verify These Work

- [ ] Build without providers: `bun run type-check && bun run build`
- [ ] Build with providers: Install packages → typecheck → build
- [ ] Dev server: `bun run dev:ssr` starts cleanly
- [ ] End-to-end: Sign up → create workspace → sync data → upload file

### Celebrate

You've completed a major refactoring. The codebase is now:
- ✅ Provider-agnostic
- ✅ Modular and extensible
- ✅ Well-documented
- ✅ Production-ready

**Well done!** 🎉

---

## Quick Links

- [Phase 3 Full Task List](./PHASE_3_TASKS.md)
- [Phase 4 Full Task List](./PHASE_4_TASKS.md)
- [Critical Issues to Fix](./dumb-issues.md)
- [Phase 1 & 2 Status](./FINAL_STATUS.md)
- [Overall Progress](./PROGRESS_SUMMARY.md)
- [Quick Start Guide](./QUICK_START_GUIDE.md)

---

**Last Updated**: 2026-02-04  
**Status**: Planning Complete ✅  
**Ready For**: Implementation  
