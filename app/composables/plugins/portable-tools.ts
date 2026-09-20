import { useToolRegistry } from '~/utils/chat/tools-public';
import { validateToolDefinition } from '~~/shared/chat/tool-schema';
import { getPortableClientSource, invokePortableToolRequest } from './portable-client-runtime';

/**
 * Host-defined tool discovery failure codes. Shareable reports (diagnostics,
 * degraded contributions) carry only these codes: raw exception text can
 * embed plugin-influenced content or credentials, so it never leaves the
 * console here.
 */
export const TOOL_DISCOVERY_CODES = [
    'discovery-failed',
    'invalid-tool-catalog',
    'tool-definition-too-large',
    'invalid-tool-definition',
    'tool-name-not-namespaced',
    'invalid-tool-name',
] as const;

export type ToolDiscoveryCode = (typeof TOOL_DISCOVERY_CODES)[number];

export class ToolDiscoveryError extends Error {
    readonly code: ToolDiscoveryCode;
    constructor(code: ToolDiscoveryCode, message: string) {
        super(message);
        this.name = 'ToolDiscoveryError';
        this.code = code;
    }
}

function discoveryError(code: ToolDiscoveryCode, message: string): ToolDiscoveryError {
    return new ToolDiscoveryError(code, message);
}

/** Map any discovery failure to an allowlisted code; unknown errors degrade to `discovery-failed`. */
export function toolDiscoveryCode(error: unknown): ToolDiscoveryCode {
    if (error instanceof ToolDiscoveryError) return error.code;
    return 'discovery-failed';
}

/** Discover bounded, namespaced tools only for an approved workspace source. */
export async function registerPortableTools(pluginId: string): Promise<() => void> {
    const source = getPortableClientSource(pluginId);
    if (!source?.descriptor.effectiveGrants.includes('tools.register.client')) return () => {};
    const result = await invokePortableToolRequest(pluginId, 'runtime.tools');
    if (!Array.isArray(result) || result.length > 32) {
        throw discoveryError('invalid-tool-catalog', 'Plugin returned an invalid tool catalog.');
    }
    const stillCurrent = () => {
        const next = getPortableClientSource(pluginId);
        return next?.workspaceId === source.workspaceId && next.descriptor.descriptorKey === source.descriptor.descriptorKey && next.descriptor.effectiveGrants.includes('tools.register.client');
    };
    const prefix = `${pluginId.replace(/[^a-z0-9]/g, '_')}_`;
    const definitions = result.map((raw: unknown) => {
        if (JSON.stringify(raw).length > 16384) {
            throw discoveryError('tool-definition-too-large', 'Plugin tool definition is too large.');
        }
        const checked = validateToolDefinition(raw);
        // The validator's detail can echo plugin content; the shareable code
        // stays allowlisted while the detail goes to the console only.
        if (!checked.valid) throw discoveryError('invalid-tool-definition', `Plugin tool is invalid: ${checked.error}`);
        if (!checked.value.function.name.startsWith(prefix)) {
            throw discoveryError('tool-name-not-namespaced', 'Plugin tool name must use its publisher namespace.');
        }
        if (!/^[a-zA-Z0-9_]{1,64}$/.test(checked.value.function.name)) {
            throw discoveryError('invalid-tool-name', 'Invalid tool name.');
        }
        return {type:'function' as const,function:{name:checked.value.function.name,description:checked.value.function.description,parameters:checked.value.function.parameters}};
    });
    if (!stillCurrent()) return () => {};
    const handles: { dispose(): unknown }[] = [];
    try {
        for (const definition of definitions) handles.push(useToolRegistry().registerTool(
            { ...definition, runtime: 'client', ui: {label: definition.function.name.slice(prefix.length).replaceAll('_', ' '), defaultEnabled: false} },
            async (args) => {
                if (!stillCurrent()) throw new Error('The plugin workspace or version changed.');
                const result = await invokePortableToolRequest(pluginId, 'runtime.tool', {name:definition.function.name,args});
                return JSON.stringify(result);
            },
            {runtime:'client', available: () => stillCurrent()},
        ));
    } catch (error) { for (const handle of handles) handle.dispose(); throw error; }
    return () => { for (const handle of handles) handle.dispose(); };
}
