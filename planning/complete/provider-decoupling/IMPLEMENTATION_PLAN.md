# Provider Decoupling - Step-by-Step Implementation Plan

**Project**: OR3 Chat  
**Stack**: Nuxt 4, TypeScript, Bun  
**Goal**: Decouple Clerk and Convex providers so core builds without provider SDKs  

---

## Executive Summary

This document provides the exact implementation order for decoupling auth (Clerk) and sync/storage (Convex) providers from the OR3 Chat core codebase. After completion:

- Core will build/typecheck without `@clerk/nuxt`, `convex`, `convex-nuxt`, or `convex-vue` installed
- Providers become Nuxt modules installed based on wizard selection
- Default behavior (Clerk + Convex) remains identical
- New providers can be added without touching core code

**Timeline**: 13-19 days (optimistic: 10-14 days with parallel work)

---

## Success Criteria

✅ Core builds when `@clerk/nuxt` removed and `auth.provider != 'clerk'`  
✅ Core builds when `convex*` packages removed and no Convex providers selected  
✅ No provider SDK imports in auto-included zones  
✅ Default stack behavior unchanged  

---

## Phase Overview

| Phase | Days | Key Deliverable |
|-------|------|----------------|
| 0. Setup | 1-2 | Package structure, provider registry, audit |
| 1. Registries | 2-3 | 5 core registries with clear interfaces |
| 2. Refactor Core | 3-4 | Endpoints/UI use adapters, not SDKs |
| 3. Provider Packages | 4-5 | Clerk/Convex/LocalFS as Nuxt modules |
| 4. Cleanup | 2-3 | Remove provider code, verify builds |
| 5. Documentation | 1-2 | Provider docs, migration guide |

---

## Detailed Implementation Steps

See the full plan document for:
- Step-by-step instructions for each phase
- Code examples for all registries and adapters
- File paths and dependencies
- Testing strategies
- Gotchas and rollback procedures

END OF PLAN
