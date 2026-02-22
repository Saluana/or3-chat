import { computed, onMounted, type Ref } from 'vue';
import { useAsyncData } from '#imports';

export function useDocumentationContent(
    routePath: Ref<string>,
    contentOverride: Ref<string | undefined>
) {
    const { data: fetchedContent, pending, error, refresh } = useAsyncData(
        () => `doc-content:v3:${routePath.value}`,
        async () => {
            const path = routePath.value;
            if (!path.startsWith('/documentation')) return '';

            const slug = path.replace(/^\/documentation/, '') || '/start/overview';
            const markdownPath = `/_documentation${slug}.md`;

            try {
                const content = await $fetch<string>(markdownPath, {
                    responseType: 'text',
                });
                return typeof content === 'string' ? content : '';
            } catch {
                return '';
            }
        },
        {
            server: true,
            lazy: false,
            default: () => '',
            watch: [routePath],
        }
    );

    const currentContent = computed(() => {
        if (error.value) {
            return `# Page Not Found\n\nThe documentation page you're looking for doesn't exist.\n\n[← Back to Documentation](/documentation)`;
        }
        return fetchedContent.value || '';
    });

    const displayContent = computed(
        () => contentOverride.value || currentContent.value
    );

    if (import.meta.client) {
        onMounted(() => {
            if (
                routePath.value.startsWith('/documentation') &&
                !fetchedContent.value
            ) {
                void refresh();

                const slug =
                    routePath.value.replace(/^\/documentation/, '') ||
                    '/start/overview';
                const markdownPath = `/_documentation${slug}.md`;

                void $fetch<string>(markdownPath, { responseType: 'text' })
                    .then((content) => {
                        if (typeof content === 'string' && content.length > 0) {
                            fetchedContent.value = content;
                        }
                    })
                    .catch(() => {
                        // Ignore fallback errors; async-data path already handled.
                    });
            }
        });
    }

    return {
        fetchedContent,
        pending,
        error,
        currentContent,
        displayContent,
    };
}
