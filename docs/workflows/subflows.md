# Subflow record identity

Subflow nodes store a `subflowId` that must equal the referenced workflow
record ID. Titles and display labels are not registry keys. Missing or deleted
records must produce a validation error rather than select another workflow.

The installed `or3-plugin-workflows` package owns workflow loading and
subflow registry construction. Build registry entries from validated records
using their record IDs, then validate every referenced subflow before execution.
Package contributors should inspect `src/core/workflowLoad.ts` and the
execution controller in that package. The host supplies guarded record ports;
it no longer exports a `WorkflowSlashCommands` module.

For package enablement, editing, and execution, use
[Build and run a workflow](../../public/_documentation/workflows/editor.md).
