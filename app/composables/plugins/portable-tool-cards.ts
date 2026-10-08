import {
    defaultHostAbi,
    TOOL_CARD_FRAME_FEATURE
} from '~~/shared/plugins/isolation/portable-bootstrap';
import { getPortableClientSource } from './portable-client-runtime';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { registerToolCardBinding } from '~/composables/chat/tool-cards';
export function registerPortableToolCards(pluginId: string): () => void {
    const source = getPortableClientSource(pluginId);
    if (!source?.descriptor.effectiveGrants.includes('chat.tool.card')) return () => {};
    const handles: { dispose(): unknown }[] = [];
    try {
        for (const card of source.descriptor.toolCards ?? []) {
            if (useToolRegistry().ownerOf(card.tool) !== pluginId) continue;
            if (
                card.embeds &&
                !source.descriptor.effectiveGrants.includes('chat.tool.card.embed')
            )
                continue;
            handles.push(
                registerToolCardBinding({
                    ...card,
                    ownerPluginId: pluginId,
                    // Keep display-only metadata for the fallback; activate frames only with the advertised feature.
                    source: defaultHostAbi().features.includes(TOOL_CARD_FRAME_FEATURE)
                        ? {
                              kind: 'frame',
                              pluginId,
                              packageDigest: source.descriptor.artifact.packageDigest,
                              card
                          }
                        : { kind: 'unsupported', code: 'runtime-unsupported' },
                    available: () =>
                        getPortableClientSource(pluginId)?.descriptor.descriptorKey ===
                        source.descriptor.descriptorKey
                })
            );
        }
    } catch (error) {
        for (const handle of handles) handle.dispose();
        throw error;
    }
    return () => {
        for (const handle of handles) handle.dispose();
    };
}
