import { useWorkflowStorage as useCoreStorage } from '@or3/workflow-vue';
import { LocalStorageAdapter, type WorkflowData } from '@or3/workflow-core';

export type SavedWorkflow = WorkflowData & { id: string };

export function useWorkflowStorage() {
    const adapter = new LocalStorageAdapter('or3-workflow-saved');
    const { workflows, loadList, load, save, remove } = useCoreStorage(adapter);

    // Wrapper to match demo's expected API
    const savedWorkflows = workflows;

    // Autosave adapter - needs to be declared before functions that use it
    const autosaveAdapter = new LocalStorageAdapter('or3-workflow-autosave');

    function loadSavedWorkflows() {
        return loadList();
    }

    // ... (rest of file)

    async function saveWorkflow(workflow: WorkflowData) {
        await save(workflow);
        // Return the workflow for compatibility
        return workflow;
    }

    function deleteWorkflow(id: string) {
        return remove(id);
    }

    function exportWorkflow(workflow: WorkflowData): void {
        const payload = {
            ...workflow,
            meta: {
                ...workflow.meta,
                exportedAt: new Date().toISOString(),
            },
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (workflow.meta.name || 'workflow')
            .replace(/\s+/g, '-')
            .toLowerCase();
        a.download = `${safeName}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function importWorkflow(file: File): Promise<WorkflowData> {
        const content = await file.text();
        const data = JSON.parse(content);

        if (!data.nodes || !data.edges) {
            throw new Error('Invalid workflow file format');
        }

        const now = new Date().toISOString();
        return {
            meta: {
                version: data.meta?.version || '2.0.0',
                name: data.meta?.name || data.name || 'Imported Workflow',
                description: data.meta?.description || data.description,
                createdAt: data.meta?.createdAt || now,
                updatedAt: data.meta?.updatedAt || now,
            },
            nodes: data.nodes,
            edges: data.edges,
        };
    }

    function autosave(workflow: WorkflowData): void {
        autosaveAdapter.autosave(workflow);
    }

    function loadAutosave(): WorkflowData | null {
        return autosaveAdapter.loadAutosave();
    }

    return {
        savedWorkflows,
        storage: adapter,
        loadSavedWorkflows,
        loadList,
        load,
        saveWorkflow,
        deleteWorkflow,
        exportWorkflow,
        importWorkflow,
        autosave,
        loadAutosave,
    };
}
