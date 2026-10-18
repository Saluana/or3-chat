---
name: or3-core-development
description: Fix OR3 Chat core defects, host-owned behavior, or missing public extension contracts when supported configuration, themes, plugins, and providers are insufficient.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout and Bun for repository validation commands.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OR3 core development

Use the smallest affected core boundary for a defect or host-owned capability.
For new extensibility, prefer a supported configuration, theme, plugin, or provider surface; explain a missing contract when that choice is material.

## Contracts

- Use [repository navigation](../../shared/repository-navigation.md) to locate current public types, registries, callers, and canonical tests.
- Preserve static/SSR boundaries, workspace scoping, and unrelated worktree changes.
- Define new contracts around their actual consumers, with explicit lifecycle, authorization, ownership, and failure behavior.
- Route the first consumer through the contract rather than a privileged one-off path.
- Preserve established registration ordering, cleanup, and error-isolation semantics; add abstractions only for demonstrated needs.
- Keep private aliases out of public types and SDK imports.
- Update the relevant public docs and docmap when the contract changes.

Verify changed behavior through the smallest appropriate canonical suite and relevant type checks.
Cross-runtime changes need the affected static/SSR or integration checks; known failed validation blocks packaging or promotion.

See [quality gates](../../shared/quality-gates.md), [permissions and trust](../../shared/permissions-and-trust.md), and [completion guidance](../../shared/completion-contract.md).
When adding hooks, use the checkout's `public/_documentation/hooks/reference.md`.
