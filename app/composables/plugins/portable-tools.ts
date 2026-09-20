import { useToolRegistry } from '~/utils/chat/tools-public';
import { validateToolDefinition } from '~~/shared/chat/tool-schema';
import { getPortableClientSource, invokePortableToolRequest } from './portable-client-runtime';

/** Discover bounded, namespaced tools only for an approved workspace source. */
export async function registerPortableTools(pluginId: string): Promise<() => void> {
    const source = getPortableClientSource(pluginId);
    if (!source?.descriptor.effectiveGrants.includes('tools.register.client')) return () => {};
    const result = await invokePortableToolRequest(pluginId, 'runtime.tools');
    if (!Array.isArray(result) || result.length > 32) throw new Error('Plugin returned an invalid tool catalog.');
    const stillCurrent = () => {
        const next = getPortableClientSource(pluginId);
        return next?.workspaceId === source.workspaceId && next.descriptor.descriptorKey === source.descriptor.descriptorKey && next.descriptor.effectiveGrants.includes('tools.register.client');
    };
    const prefix = `${pluginId.replace(/[^a-z0-9]/g, '_')}_`;
    const definitions = result.map((raw: unknown) => {
        if (JSON.stringify(raw).length > 16384) throw new Error('Plugin tool definition is too large.');
        const checked = validateToolDefinition(raw);
        if (!checked.valid) throw new Error(`Plugin tool is invalid: ${checked.error}`);
        if (!checked.value.function.name.startsWith(prefix)) throw new Error('Plugin tool name must use its publisher namespace.');
        if (!/^[a-zA-Z0-9_]{1,64}$/.test(checked.value.function.name)) throw new Error('Invalid tool name.');
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
