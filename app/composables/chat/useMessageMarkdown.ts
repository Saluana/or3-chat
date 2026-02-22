import { computed, type Ref } from 'vue';
import { useNuxtApp } from '#app';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';

type MessageLike = {
    role: string;
    text?: string;
};

const FILE_HASH_IMG_RE = /!\[[^\]]*]\(file-hash:([a-f0-9-]{6,})\)/gi;

export function useMessageMarkdown(message: Ref<MessageLike>) {
    const assistantMarkdown = computed(() =>
        message.value.role === 'assistant' ? message.value.text || '' : ''
    );

    const processedAssistantMarkdown = computed(() => {
        if (message.value.role !== 'assistant') return '';
        return assistantMarkdown.value.replace(
            FILE_HASH_IMG_RE,
            (_, hash) => `![file-hash:${hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`
        );
    });

    const nuxtApp = useNuxtApp();
    const themePlugin = computed<ThemePlugin>(() => nuxtApp.$theme);
    const currentShikiTheme = computed(() => {
        const themeObj = themePlugin.value;
        const themeName = themeObj.current?.value ?? themeObj.get();
        return String(themeName).startsWith('dark')
            ? 'github-dark'
            : 'github-light';
    });

    return {
        assistantMarkdown,
        processedAssistantMarkdown,
        currentShikiTheme,
    };
}
