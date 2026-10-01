import { computed, type Ref } from 'vue';
import { useAsyncData } from '#imports';

// Public assets are not available to Nitro's internal $fetch during SSR.
// Vite supplies lazy raw modules so direct visits render the same Markdown.
const bundledPages = import.meta.glob(
    '../../../public/_documentation/**/*.md',
    { query: '?raw', import: 'default' }
) as Record<string, () => Promise<string>>;

export function useDocumentationContent(
    routePath: Ref<string>,
    contentOverride: Ref<string | undefined>
) {
    const { data: fetchedContent, pending, error, refresh } = useAsyncData(
        () => `doc-content:v4:${routePath.value}`,
        async () => {
            const path = routePath.value;
            if (!path.startsWith('/documentation')) return '';

            const slug = path.replace(/^\/documentation/, '') || '/start/overview';
            const markdownPath = `/_documentation${slug}.md`;

            if (import.meta.server) {
                const load = bundledPages[`../../../public/_documentation${slug}.md`];
                if (!load) throw new Error('Documentation page not found');
                return await load();
            }
            return await $fetch<string>(markdownPath, {
                responseType: 'text',
            });
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

    return {
        fetchedContent,
        pending,
        error,
        currentContent,
        displayContent,
    };
}
