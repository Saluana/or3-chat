import { computed, type Ref } from 'vue';
import { useNuxtApp } from '#app';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';

type MessageLike = {
    role: string;
    text?: string;
};

const FILE_HASH_IMG_RE = /!\[[^\]]*]\(file-hash:([a-f0-9-]{6,})\)/gi;

export function processAssistantMarkdown(markdown: string): string {
    if (!markdown.includes('file-hash:')) return markdown;
    return markdown.replace(
        FILE_HASH_IMG_RE,
        (_, hash) => `![file-hash:${hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`
    );
}

export function useMessageMarkdown(message: Ref<MessageLike>) {
    const assistantMarkdown = computed(() =>
        message.value.role === 'assistant' ? message.value.text || '' : ''
    );

    let lastProcessedInput = '';
    let lastProcessedOutput = '';
    const processedAssistantMarkdown = computed(() => {
        if (message.value.role !== 'assistant') return '';
        const markdown = assistantMarkdown.value;
        if (markdown === lastProcessedInput) {
            return lastProcessedOutput;
        }
        lastProcessedInput = markdown;
        lastProcessedOutput = processAssistantMarkdown(markdown);
        return lastProcessedOutput;
    });

    const nuxtApp = useNuxtApp();
    const themePlugin = computed<ThemePlugin>(() => nuxtApp.$theme);
    const currentShikiTheme = computed(() => {
        const themeObj = themePlugin.value;
        const themeName = themeObj.current.value;
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
