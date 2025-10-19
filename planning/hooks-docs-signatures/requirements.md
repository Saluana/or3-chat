---
artifact_id: 9f0f2a34-2e9a-4a0b-8a19-61ac7f38a9e6
title: Hook docs – callback signatures and returns
owner: docs
status: draft
---

# requirements.md

## Introduction

We will standardize how return values for hooks are documented by introducing canonical TypeScript callback aliases and referencing them across the Hooks documentation set. The goal is to make it obvious what a callback must return for actions vs filters, reduce wording duplication, and prevent table formatting errors.

Scope covers the core Hooks docs in `public/_documentation/hooks/*`, with minimal, safe edits to related pages that mention hook callbacks (e.g., composables like `useHookEffect`). No runtime behavior will change.

## User stories and acceptance criteria

1. Action callback return contract

    - As a contributor, I want a clear, reusable type for action callbacks, so I can quickly understand what my function should return.
    - Acceptance criteria:
        - WHEN I open `hooks.md` THEN I SHALL see a “Type aliases” subsection declaring `type ActionHandler = (...args: any[]) => void | Promise<void>`.
        - WHEN I read the API table THEN `addAction`, `doAction`, `on(kind='action')` SHALL reference `ActionHandler` in text or examples.

2. Filter callback return contract

    - As a contributor, I want a generic filter type that makes input and output explicit, so I can reason about value threading.
    - Acceptance criteria:
        - WHEN I open `hooks.md` THEN I SHALL see `type FilterHandler<TIn, TOut = TIn> = (value: TIn, ...args: any[]) => TOut | Promise<TOut>`.
        - WHEN I read entries for `addFilter`/`applyFilters`/`applyFiltersSync` THEN docs SHALL reference `FilterHandler` and clarify that the returned value becomes the next value in the chain.

3. One-sentence “returns” guidance in Core concepts

    - As a reader, I want a compact “Action vs Filter returns” explanation, so I don’t have to search.
    - Acceptance criteria:
        - WHEN I scan “Core concepts” THEN there SHALL be a bullet or short paragraph explicitly stating action handlers return void, filters return the transformed value.

4. Cross-references in related hook docs

    - As a reader, I want consistency across hook-related pages, so rules don’t drift.
    - Acceptance criteria:
        - WHEN I open `typed-hooks.md`, `hook-types.md`, `useHooks.md`, and `useHookEffect.md` THEN each SHALL include a brief note referencing the canonical `ActionHandler` and `FilterHandler` aliases in `hooks.md`.

5. Rendering stability

    - As a maintainer, I want the tables and code fences to render correctly, so docs are readable.
    - Acceptance criteria:
        - IF a signature contains a `|` THEN the doc SHALL escape it as `\\|` in tables.
        - WHEN I run a static site build (Nuxt generate) THEN the Hooks pages SHALL render without broken tables.

6. Non-goals (for clarity)
    - No changes to runtime hook engine or types in `app/core/hooks/`.
    - No changes to navigation structure beyond light cross-reference notes.

## Non-functional requirements

-   Consistency: Use the same alias names and wording across all affected pages.
-   Minimalism: Keep changes small and low-risk—no new build steps or dependencies.
-   Performance: Docs-only changes; no impact on runtime.

## Dependencies / integration

-   Existing docs: `public/_documentation/hooks/hooks.md`, `hook-keys.md`, `hook-types.md`, `typed-hooks.md`, `useHooks.md`, `public/_documentation/composables/useHookEffect.md`.
-   Rendering: Nuxt docs shell and `docmap.json` (no nav changes required).

## Out of scope (future ideas)

-   Auto-generated API from `.d.ts` using typedoc (larger effort).
-   Unit tests that validate Markdown code cells compile (CI enhancement).
