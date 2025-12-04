/**
 * Workflow Slash Commands Plugin - Public API
 *
 * Re-exports all public functions and types for the slash commands feature.
 */

// Extension
export { SlashCommand, SlashCommandPluginKey } from './slashCommandExtension';
export type { SlashCommandOptions } from './slashCommandExtension';

// Suggestion configuration
export { createSlashCommandSuggestion } from './suggestions';

// Search and lookup functions
export {
    searchWorkflows,
    getWorkflowByName,
    getWorkflowById,
} from './useWorkflowSlashCommands';
export type { WorkflowItem } from './useWorkflowSlashCommands';

// Execution
export {
    parseSlashCommand,
    executeWorkflow,
    getConversationHistory,
} from './executeWorkflow';
export type {
    WorkflowExecutionOptions,
    WorkflowExecutionResult,
    WorkflowExecutionController,
} from './executeWorkflow';
