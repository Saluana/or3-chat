<template>
    <main
        class="h-dvh min-h-0"
        data-testid="production-document-journey"
    >
        <span class="sr-only" data-testid="document-journey-id">
            {{ documentId || 'loading' }}
        </span>
        <span class="sr-only" data-testid="persisted-document-title">
            {{ persistedTitle }}
        </span>
        <span class="sr-only" data-testid="persisted-document-body">
            {{ persistedBody }}
        </span>
        <DocumentEditor
            v-if="documentId"
            :document-id="documentId"
            class="h-full"
        />
    </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import DocumentEditor from '~/components/documents/DocumentEditor.vue';
import { createDocument, getDocument } from '~/db/documents';

const DOCUMENT_KEY = 'or3:e2e:production-document-id';
const documentId = ref('');
const persistedTitle = ref('');
const persistedBody = ref('');
let persistedRecordTimer: ReturnType<typeof setInterval> | undefined;

function documentText(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const node = value as { text?: string; content?: unknown[] };
    return [
        node.text ?? '',
        ...(node.content ?? []).map(documentText),
    ].join('');
}

async function refreshPersistedRecord(): Promise<void> {
    if (!documentId.value) return;
    const record = await getDocument(documentId.value);
    persistedTitle.value = record?.title ?? '';
    persistedBody.value = documentText(record?.content);
}

onMounted(async () => {
    const rememberedId = localStorage.getItem(DOCUMENT_KEY);
    const remembered = rememberedId
        ? await getDocument(rememberedId)
        : null;
    if (remembered) {
        documentId.value = remembered.id;
    } else {
        const created = await createDocument({
            title: 'Journey draft',
            content: {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Initial document text.' }],
                    },
                ],
            },
        });
        localStorage.setItem(DOCUMENT_KEY, created.id);
        documentId.value = created.id;
    }

    await refreshPersistedRecord();
    persistedRecordTimer = setInterval(() => {
        void refreshPersistedRecord();
    }, 100);
});

onBeforeUnmount(() => {
    if (persistedRecordTimer) clearInterval(persistedRecordTimer);
});
</script>
