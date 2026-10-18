---
name: doc-maker
description: Write or update OR3 source API documentation and public guides, grounded in the current implementation and callers.
---

# OR3 documentation

Use `public/_documentation/docmap.json` to locate the maintained guide before adding another document.
Source types, actual callers, and executable behavior define the contract.

- Explain intent, correct usage, and non-obvious guarantees or constraints; do not narrate code or repeat its types.
- Keep JSDoc proportional to the API and use standard tags only when they add information.
- Distinguish public APIs from exported internals; document private helpers only when their contract needs explanation.
- Use realistic examples with current imports, setup, and cleanup; verify they match the supported runtime.
- For hooks, state emission timing, payload/return types, and any actual veto semantics.
- For composables, explain setup/lifecycle requirements and resource ownership.
- For data and server APIs, document workspace scope, wire format, error behavior, authorization, and static/SSR boundaries where relevant.
- Update affected docmap entries and links when adding, moving, or retiring public pages.
- Prefer plain, durable language and keep conceptual explanation, usage, and reference material easy to navigate.

Current starting points:

- [Source map](../../../public/_documentation/start/source-map.md)
- [Hook reference](../../../public/_documentation/hooks/reference.md)
- [Database safety](../../../public/_documentation/database/safe-changes.md)
- [Public types](../../../public/_documentation/types/overview.md)

Infer audience and scope from the request and existing docs; ask only when a material ambiguity remains.
