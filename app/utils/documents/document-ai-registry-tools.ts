import { useToolRegistry, type RegisteredTool } from '~/utils/chat/tool-registry';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import {
    DOCUMENT_AI_AGENT_TOOLS,
    isDocumentAiNativeTool,
    isDocumentAiToolEnabled,
    resolveDocumentAiAgentTools,
} from './document-ai-tools';

export interface DocumentAiToolToggleRow {
    name: string;
    label: string;
    description: string;
    icon?: string;
    category: string;
    source: 'document' | 'chat';
    enabled: boolean;
    runtime?: ToolDefinition['runtime'];
}

/** Chat-registry tools Document AI can run in the foreground (not server-only). */
export function listDocumentAiRegistryCandidates(
    tools: readonly RegisteredTool[] = useToolRegistry().listTools.value,
): RegisteredTool[] {
    return tools.filter((tool) => (
        !isDocumentAiNativeTool(tool.definition.function.name)
        && tool.runtime !== 'server'
    ));
}

export function buildDocumentAiToolToggleRows(
    enabledTools: Readonly<Record<string, boolean>>,
    registryTools: readonly RegisteredTool[] = useToolRegistry().listTools.value,
): DocumentAiToolToggleRow[] {
    const nativeRows: DocumentAiToolToggleRow[] = DOCUMENT_AI_AGENT_TOOLS.map((tool) => ({
        name: tool.function.name,
        label: tool.ui?.label || tool.function.name,
        description: tool.ui?.descriptionHint || tool.function.description,
        icon: tool.ui?.icon,
        category: tool.ui?.category || 'Document',
        source: 'document',
        enabled: isDocumentAiToolEnabled(tool.function.name, enabledTools),
    }));

    const chatRows: DocumentAiToolToggleRow[] = listDocumentAiRegistryCandidates(registryTools).map((tool) => {
        const def = tool.definition;
        return {
            name: def.function.name,
            label: def.ui?.label || def.function.name,
            description: def.ui?.descriptionHint || def.function.description || '',
            icon: def.ui?.icon,
            category: def.ui?.category || 'Chat',
            source: 'chat',
            enabled: isDocumentAiToolEnabled(def.function.name, enabledTools),
            runtime: tool.runtime,
        };
    });

    return [...nativeRows, ...chatRows];
}

export function resolveDocumentAiToolsForRun(
    enabledTools: Readonly<Record<string, boolean>>,
): ToolDefinition[] {
    const registryDefinitions = listDocumentAiRegistryCandidates().map((tool) => tool.definition);
    return resolveDocumentAiAgentTools({ enabledTools, registryDefinitions });
}

export async function executeDocumentAiRegistryTool(params: {
    name: string;
    argumentsJson: string;
    context: ToolExecutionContext;
    /** Definition advertised to the model for this run — pins admission. */
    admittedDefinition: ToolDefinition;
}): Promise<string> {
    const registry = useToolRegistry();
    const execution = await registry.executeTool(
        params.name,
        params.argumentsJson,
        params.context,
        {
            definition: params.admittedDefinition,
            // Document AI uses enabledTools, not chat-global toggles.
            ignoreGlobalEnabled: true,
        },
    );
    if (execution.error) {
        throw new Error(execution.error);
    }
    return execution.result ?? '';
}
