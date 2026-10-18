---
name: hooks-system
description: Add or debug OR3 host actions, filters, typed hook contracts, and listener lifecycle behavior.
---

# OR3 hooks

The installed host hook engine is the extension point; do not create a second engine or use hook failure isolation as authorization.
Installable plugins use the SDK's supported hook capabilities and grants rather than private app imports.

- Use current emitted names and payloads from the [catalog](../../../public/_documentation/hooks/hook-catalog.md); a typed name alone does not mean core emits it.
- Actions observe events; filters transform values and must return the intended next value.
- Async dispatch is sequential and awaited; synchronous emitters require synchronous callbacks.
- Preserve caller-defined veto behavior rather than assuming every filter cancels on `false` or an empty string.
- Retain listener disposers and clean them up at the owning lifecycle boundary, including HMR.
- Follow existing naming and priority conventions, keep filters fast, and update payload types/docs with new contracts.
- Component setup can use `useHookEffect`; utilities outside setup should use the existing cached accessors and handle unavailable startup state.
- SSR hook engines are request-scoped; never reuse a client cache across requests.

Read the [API, types, and lifecycle reference](../../../public/_documentation/hooks/reference.md) for exact registration and dispatch behavior.
Dexie sync capture is a separate atomic contract described in [sync internals](../../../public/_documentation/cloud/sync-layer.md).
