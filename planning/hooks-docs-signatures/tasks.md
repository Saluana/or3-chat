---
artifact_id: 3e4e7e7c-6e34-4c9a-9e0b-2f30f7ed7f3a
title: Hook docs – implementation tasks
owner: docs
status: draft
---

# tasks.md

1. Add canonical aliases and returns guidance in hooks.md

    - [ ] Insert a “Type aliases” subsection with `ActionHandler` and `FilterHandler` (Requirements: 1, 2)
    - [ ] Add a compact “Action vs Filter returns” note in Core concepts (Requirements: 3)
    - [ ] Update action API entries to reference `ActionHandler` (Requirements: 1)
    - [ ] Update filter API entries to reference `FilterHandler` and chaining (Requirements: 2)
    - [ ] Ensure any table cells containing `|` escape as `\\|` (Requirements: 5)

2. Add cross-reference notes in related pages

    - [ ] typed-hooks.md: short note linking to aliases in hooks.md (Requirements: 4)
    - [ ] hook-types.md: short note linking to aliases in hooks.md (Requirements: 4)
    - [ ] useHooks.md: short note linking to aliases in hooks.md (Requirements: 4)
    - [ ] useHookEffect.md: short note linking to aliases in hooks.md (Requirements: 4)

3. Build and verify rendering

    - [ ] Run a local docs build and visually verify hooks pages (Requirements: 5)
    - [ ] Spot-check the API table cells with union types are escaped (Requirements: 5)

4. Documentation hygiene
    - [ ] Keep wording consistent across pages; avoid duplication beyond the one-sentence note (Requirements: NF-Consistency)
    - [ ] Keep edits minimal and isolated to docs (Requirements: NF-Minimalism)
