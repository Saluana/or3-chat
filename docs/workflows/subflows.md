# Subflow Registry and ID Alignment

Subflow nodes store a `subflowId` that references a workflow record. The
subflow picker uses workflow **record IDs**, not titles. Execution only works
when the subflow registry is built with the same IDs.

## Required Behavior

-   Subflow node `subflowId` must equal the workflow record ID.
-   The subflow registry must be built from workflow records (not custom IDs).
-   If a subflow ID is missing from the registry, execution fails with a
    validation error.

## Registry Build Pattern

When executing workflows, load all workflow posts and register them by record
ID:

```ts
import { DefaultSubflowRegistry, createSubflowDefinition } from '@or3/workflow-core';
import { listWorkflowsWithMeta } from '~/plugins/WorkflowSlashCommands/useWorkflowSlashCommands';

const records = await listWorkflowsWithMeta();
const registry = new DefaultSubflowRegistry();

for (const record of records) {
    if (!record.meta) continue;
    registry.register(
        createSubflowDefinition(record.id, record.title, record.meta)
    );
}
```

## Validation

Execution code should validate that every `subflowId` in the workflow exists in
the registry before running:

-   Missing IDs are usually caused by deleted workflows or mismatched registry
    IDs.
-   Fixes should update the registry builder, not the node IDs.
