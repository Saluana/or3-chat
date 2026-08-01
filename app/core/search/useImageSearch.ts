import { ref, watch, type Ref } from 'vue';
import type { FileMeta } from '~/db/schema';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';

interface ImageSearchDoc {
    id: string;
    name: string;
    mime: string;
}

type OramaInstance = Record<string, unknown>;

export function useImageSearch(images: Ref<FileMeta[]>) {
    const query = ref('');
    const results = ref<FileMeta[]>(images.value);
    const busy = ref(false);
    let currentDb: OramaInstance | null = null;
    let lastIndexedCount = -1;
    let queryToken = 0;

    const fallback = (raw: string) => {
        const needle = raw.toLocaleLowerCase();
        return images.value.filter((image) =>
            `${image.name}\n${image.mime_type}`
                .toLocaleLowerCase()
                .includes(needle)
        );
    };

    async function rebuild() {
        if (!process.client || busy.value) return;
        busy.value = true;
        try {
            currentDb = (await createDb({
                id: 'string',
                name: 'string',
                mime: 'string',
            })) as OramaInstance | null;
            if (currentDb) {
                const docs: ImageSearchDoc[] = images.value.map((image) => ({
                    id: image.hash,
                    name: image.name,
                    mime: image.mime_type,
                }));
                await buildOramaIndex(currentDb, docs);
            }
            lastIndexedCount = images.value.length;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        const raw = query.value.trim();
        if (!raw) {
            results.value = images.value;
            return;
        }
        if (!currentDb || lastIndexedCount !== images.value.length)
            await rebuild();
        const token = ++queryToken;
        if (!currentDb) {
            results.value = fallback(raw);
            return;
        }
        try {
            const response = await searchWithIndex(currentDb, raw, 200);
            if (token !== queryToken) return;
            const byHash = new Map(
                images.value.map((image) => [image.hash, image])
            );
            const hits = (
                Array.isArray(response.hits) ? response.hits : []
            ) as Array<{
                document?: { id?: string };
                id?: string;
            }>;
            const matched = hits
                .map((hit) => byHash.get((hit.document ?? hit).id ?? ''))
                .filter((image): image is FileMeta => Boolean(image));
            results.value = matched.length ? matched : fallback(raw);
        } catch {
            results.value = fallback(raw);
        }
    }

    watch(images, async () => {
        if (images.value.length !== lastIndexedCount) await rebuild();
        await runSearch();
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    watch(query, () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => void runSearch(), 120);
    });

    return { query, results, busy, rebuild, search: runSearch };
}
