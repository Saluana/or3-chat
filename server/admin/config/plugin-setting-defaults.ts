/** Legacy deployment switches become defaults for the separately installed package. */
export function buildPluginSettingDefaults(workflows: { enabled: boolean; editor: boolean; slashCommands: boolean; execution: boolean }, appConfig?: { workflowSlashCommands?: { enabled?: boolean } }): Record<string, Record<string, boolean>> {
    return { 'or3-workflows': { enabled: workflows.enabled, editor: workflows.editor, slashCommands: workflows.slashCommands, execution: workflows.execution, ...(appConfig ? { workflowSlashEnabled: appConfig.workflowSlashCommands?.enabled !== false } : {}) } };
}
