---
name: or3-core-development
description: Modify OR3 Chat core only when configuration, themes, plugins, and providers cannot support the requested behavior. Use for a missing public extension contract, a core bug, or an inherently host-owned capability.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout and Bun for repository validation commands.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OR3 core development

## Purpose

Make the smallest safe core change, favoring a stable public contract that lets
the requested behavior be implemented without creating another hard-coded path.

## When to use

Use for a genuine core defect, host-owned behavior, or an extension request
that cannot be expressed through configuration, themes, plugins, or providers.
Do not start here because core files are convenient; use the
[extension decision tree](../../shared/extension-decision-tree.md) first.

## Core-entry gate

Before editing, record all five answers in the work report:

- Why configuration is insufficient.
- Why a theme is insufficient.
- Why a plugin is insufficient.
- Why a provider is insufficient or irrelevant.
- The requested public contract and its expected consumer.

If a supported lower surface is sufficient, stop and route there. For a core
bug, identify the failing behavior and smallest affected boundary instead.

## Required first steps

1. Read [repository navigation](../../shared/repository-navigation.md).
2. Use the docmap to find public documentation for the behavior; inspect public
   types, existing registrations/hooks, callers, examples, and canonical tests.
3. Check static/SSR and local-first boundaries before importing a dependency or
   changing a registration path. Preserve unrelated worktree changes.

## Contract-first workflow

1. Define a domain-named contract with one responsibility: type, lifecycle,
   registration/dispatch semantics, capability boundary, and failure behavior.
2. Add tests for contract behavior before or with the implementation. Keep
   invalid states unrepresentable and validate untrusted input at the boundary.
3. Implement typed registration or dispatch, including cleanup, ordering, and
   error isolation only where existing contracts establish those semantics.
4. Implement the requested first consumer through the contract when practical;
   do not create a privileged one-off path that bypasses it.
5. Update the relevant public document and `public/_documentation/docmap.json`.
   Describe compatibility or migration impact precisely.
6. Run the canonical targeted tests and relevant typecheck. Run static/SSR or
   integration checks when the change crosses that boundary; do not widen test
   scope without evidence.

## Constraints

- Do not add a new service, queue, cache, global singleton, or abstraction
  without a demonstrated requirement.
- Server-only code stays under `server/**`; client code must not pull server
  SDKs into static builds.
- Public types and SDK contracts must not leak private aliases to external
  consumers.
- A known failing validation blocks packaging, promotion, and completion.

## Completion output

Follow the [completion contract](../../shared/completion-contract.md). Include
the core-entry evidence, public contract, callers reviewed, compatibility
impact, documentation/docmap updates, checks, and a concrete revert path.

## References to load

- [Quality gates](../../shared/quality-gates.md)
- [Permissions and trust](../../shared/permissions-and-trust.md)
- Relevant path selected from `public/_documentation/docmap.json`
- `public/_documentation/hooks/typed-hooks.md` when adding a hook contract
