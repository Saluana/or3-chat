import { computed, type ComputedRef } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type { PaletteResult } from '~/core/search/command-palette/types';

/**
 * Palette icons resolve through the icon-token registry so each theme can swap
 * the whole set. Plugin-provided icons are respected when no token matches.
 */
export function usePaletteIcons(): {
    categoryIcons: ComputedRef<Record<string, string>>;
    iconForResult: (result: PaletteResult) => string;
    fallbackIcon: ComputedRef<string>;
} {
    const command = useIcon('palette.command');
    const chat = useIcon('palette.chat');
    const document = useIcon('palette.document');
    const project = useIcon('palette.project');
    const prompt = useIcon('palette.prompt');
    const workflow = useIcon('palette.workflow');
    const image = useIcon('palette.image');
    const setting = useIcon('palette.setting');
    const dashboard = useIcon('palette.dashboard');
    const fallbackIcon = useIcon('palette.result');

    const categoryIcons = computed<Record<string, string>>(() => ({
        command: command.value,
        chat: chat.value,
        document: document.value,
        project: project.value,
        prompt: prompt.value,
        workflow: workflow.value,
        image: image.value,
        setting: setting.value,
        dashboard: dashboard.value,
    }));

    function iconForResult(result: PaletteResult): string {
        // Commands carry a per-command icon supplied by the host, so it wins.
        if (result.categoryId === 'command' && result.icon) return result.icon;
        return (
            categoryIcons.value[result.categoryId] ??
            result.icon ??
            fallbackIcon.value
        );
    }

    return { categoryIcons, iconForResult, fallbackIcon };
}
