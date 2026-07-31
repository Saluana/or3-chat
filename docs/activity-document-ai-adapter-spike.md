# Document AI Activity Adapter Spike

Decision: **No-go for the initial Activity Center sources.**

## Evidence

- `useDocumentAiAgent` owns editor prompt state, streaming, proposal review, and
  accept/reject behavior inside the document pane lifecycle.
- `documentAiLifecycle.ts` deliberately models only local generation ownership,
  abort races, editor locking, and serialized proposal acceptance.
- A stable run identifier, list API, detached subscription API, canonical
  terminal history, and run-scoped action dispatcher do not currently exist.
- Exposing the current composable directly would make Activity depend on TipTap
  and mounted editor state, contrary to the Activity source boundary.

## Required boundary before reconsideration

Document AI may register an Activity source after it provides a framework-free
internal run directory with:

1. stable run and document IDs;
2. list/get snapshots backed by its existing canonical state;
3. lifecycle subscription with explicit disposal;
4. run-scoped cancel/open-document actions;
5. no TipTap, Vue component, or editor instance in the contract.

This decision does not change Document AI behavior and adds no duplicate
persistence. Workflow execution and background chat remain the V1 sources.

