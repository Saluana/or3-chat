<template>
    <main class="canary-shell">
        <header class="canary-controls">
            <button data-testid="append" @click="appendMessage">append</button>
            <button data-testid="prepend" @click="prependMessage">prepend</button>
            <button data-testid="mutate" @click="mutateMiddle">mutate</button>
            <button data-testid="switch" @click="switchThread">switch</button>
            <button data-testid="stream" @click="toggleStreaming">stream</button>
            <output data-testid="ready">{{ ready ? 'ready' : 'loading' }}</output>
        </header>

        <Or3Scroll
            ref="scroller"
            :items="messages"
            :item-key="(message) => message.id"
            :estimate-height="80"
            :overscan="renderOverscan"
            :prefetch-overscan="prefetchOverscan"
            :content-key="threadId"
            mutation-mode="arbitrary"
            :maintain-bottom="maintainBottom"
            :bottom-threshold="5"
            :padding-top="28"
            class="canary-scroll"
            @scroll="sample"
            @prefetch-range="onPrefetchRange"
        >
            <template #default="{ item, index }">
                <div
                    class="canary-message"
                    :data-canary-index="index"
                    :data-canary-key="item.id"
                >
                    <ChatMessage :message="item" :thread-id="threadId" />
                </div>
            </template>
            <template #__debug><span hidden data-canary-debug /></template>
        </Or3Scroll>

        <output data-testid="snapshot">{{ JSON.stringify(snapshot) }}</output>
    </main>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import ChatMessage from '~/components/chat/ChatMessage.vue';
import { createOrRefFile, derefFile } from '~/db/files';
import { createMessageMediaPrefetchController } from '~/composables/chat/useMessageMediaPrefetch';
import { useThumbnailUrlCache } from '~/composables/core/useThumbnailUrlCache';
import type { UiChatMessage } from '~/utils/chat/uiMessages';

type ScrollApi = {
    scrollToBottom: () => void;
    scrollToIndex: (
        index: number,
        options?: { align?: 'start' | 'center' | 'end' }
    ) => void;
};

type Snapshot = {
    renderedRows: number;
    readyImages: number;
    scrollTop: number;
    scrollHeight: number;
    trackHeight: number;
    visibleAnchor: string | null;
    anchorOffset: number | null;
    bottomDistance: number;
    hasScrollApi: boolean;
    hasVisibleRows: boolean;
};

const scroller = ref<ScrollApi | null>(null);
const threadId = ref('canary-thread-a');
const renderOverscan = ref(5500);
const prefetchOverscan = ref(5500);
const maintainBottom = ref(true);
const ready = ref(false);
const messages = ref<UiChatMessage[]>([]);
const imageHashes = ref<string[]>([]);
const mediaPrefetch = createMessageMediaPrefetchController({ concurrency: 4 });
let streamTimer: ReturnType<typeof setInterval> | null = null;

const snapshot = ref<Snapshot>({
    renderedRows: 0,
    readyImages: 0,
    scrollTop: 0,
    scrollHeight: 0,
    trackHeight: 0,
    visibleAnchor: null,
    anchorOffset: null,
    bottomDistance: 0,
    hasScrollApi: false,
    hasVisibleRows: false,
});

function buildMessages(prefix: string, hashes: readonly string[]) {
    return Array.from({ length: 100 }, (_, index): UiChatMessage => {
        const isImage = index % 10 === 5 && hashes.length > 0;
        const text = Array.from(
            { length: 1 + (index % 7) },
            () => `${prefix} deterministic mixed-height row ${index}.`
        ).join(' ');
        return {
            id: `${prefix}-${index}`,
            role: isImage || index % 3 === 0 ? 'user' : 'assistant',
            text,
            file_hashes: isImage
                ? [hashes[Math.floor(index / 10) % hashes.length]!]
                : undefined,
        };
    });
}

async function createStoredImages() {
    const hashes: string[] = [];
    for (let index = 0; index < 10; index++) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="hsl(${index * 36} 70% 45%)"/><text x="32" y="190" font-size="72" fill="white">${index}</text></svg>`;
        const meta = await createOrRefFile(
            new Blob([svg], { type: 'image/svg+xml' }),
            `canary-${index}.svg`
        );
        hashes.push(meta.hash);
    }
    return hashes;
}

function onPrefetchRange(range: { startIndex: number; endIndex: number }) {
    mediaPrefetch.updateRange(messages.value, range);
}

function sample() {
    const root = document.querySelector<HTMLElement>('.canary-scroll');
    if (!root) return;
    const rows = Array.from(
        root.querySelectorAll<HTMLElement>('.or3-scroll-item')
    ).filter((row) => !row.closest('.or3-scroll-hidden-pool'));
    const visible = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        const viewport = root.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    const viewport = root.getBoundingClientRect();
    const anchorElement = visible?.querySelector<HTMLElement>(
        '[data-canary-key]'
    );
    snapshot.value = {
        renderedRows: rows.length,
        readyImages: root.querySelectorAll('img[data-file-hash]').length,
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        trackHeight: Number.parseFloat(
            root.querySelector<HTMLElement>('.or3-scroll-track')?.style.height ||
                '0'
        ),
        visibleAnchor:
            anchorElement?.dataset.canaryKey ??
            visible?.firstElementChild?.getAttribute('data-canary-key') ??
            visible?.getAttribute('data-canary-key') ??
            null,
        anchorOffset: visible
            ? visible.getBoundingClientRect().top - viewport.top
            : null,
        bottomDistance: root.scrollHeight - root.scrollTop - root.clientHeight,
        hasScrollApi:
            typeof scroller.value?.scrollToIndex === 'function' &&
            typeof scroller.value?.scrollToBottom === 'function',
        hasVisibleRows: Boolean(visible),
    };
}

function appendMessage() {
    const index = messages.value.length;
    messages.value = [
        ...messages.value,
        {
            id: `${threadId.value}-append-${index}`,
            role: 'assistant',
            text: `Appended streaming row ${index}`,
        },
    ];
    void nextTick(sample);
}

function prependMessage() {
    messages.value = [
        {
            id: `${threadId.value}-prepend-${Date.now()}`,
            role: 'user',
            text: 'Prepended history row with deterministic height.',
        },
        ...messages.value,
    ];
    void nextTick(sample);
}

function mutateMiddle() {
    const next = messages.value.slice();
    const removed = next.splice(35, 1)[0];
    if (removed) next.splice(12, 0, removed);
    messages.value = next;
    void nextTick(sample);
}

function switchThread() {
    threadId.value = threadId.value.endsWith('-a')
        ? 'canary-thread-b'
        : 'canary-thread-a';
    mediaPrefetch.reset();
    messages.value = buildMessages(threadId.value, imageHashes.value);
    void nextTick(sample);
}

function toggleStreaming() {
    if (streamTimer) {
        clearInterval(streamTimer);
        streamTimer = null;
        return;
    }
    appendMessage();
    streamTimer = setInterval(() => {
        const next = messages.value.slice();
        const tail = next[next.length - 1];
        if (!tail) return;
        next[next.length - 1] = { ...tail, text: `${tail.text} chunk` };
        messages.value = next;
    }, 30);
}

onMounted(async () => {
    imageHashes.value = await createStoredImages();
    messages.value = buildMessages(threadId.value, imageHashes.value);
    ready.value = true;
    await nextTick();
    requestAnimationFrame(sample);
});

onBeforeUnmount(() => {
    if (streamTimer) clearInterval(streamTimer);
    mediaPrefetch.dispose();
    for (const hash of imageHashes.value) void derefFile(hash);
});

const api = {
    getSnapshot: () => {
        sample();
        return { ...snapshot.value };
    },
    setOverscan: async (render: number, prefetch: number) => {
        renderOverscan.value = render;
        prefetchOverscan.value = prefetch;
        await nextTick();
        sample();
    },
    scrollToIndex: async (index: number) => {
        scroller.value?.scrollToIndex(index, { align: 'start' });
        await nextTick();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        sample();
        return {
            hasApi: typeof scroller.value?.scrollToIndex === 'function',
            scrollTop:
                document.querySelector<HTMLElement>('.canary-scroll')?.scrollTop ??
                -1,
        };
    },
    scrollToBottom: async () => {
        const element = document.querySelector<HTMLElement>('.canary-scroll');
        const before = element?.scrollTop ?? -1;
        scroller.value?.scrollToBottom();
        const immediate = element?.scrollTop ?? -1;
        await nextTick();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        sample();
        return {
            hasApi: typeof scroller.value?.scrollToBottom === 'function',
            before,
            immediate,
            scrollTop: element?.scrollTop ?? -1,
            clientHeight: element?.clientHeight ?? -1,
            scrollHeight: element?.scrollHeight ?? -1,
            trackHeight:
                element?.querySelector<HTMLElement>('.or3-scroll-track')?.style
                    .height ?? '',
        };
    },
    setBrowsing: (value: boolean) => {
        maintainBottom.value = !value;
    },
    imageReadyAt: (index: number) => {
        const hash = messages.value[index]?.file_hashes?.[0];
        return hash
            ? useThumbnailUrlCache().get(hash)?.status === 'ready'
            : false;
    },
    appendMessage,
    mutateMiddle,
    switchThread,
};

Object.assign(window, { __or3ScrollCanary: api });
</script>

<style scoped>
.canary-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100vh;
    background: var(--md-surface, #111);
}

.canary-controls {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
}

.canary-scroll {
    min-height: 0;
}

.canary-message {
    max-width: 768px;
    margin: 0 auto;
    padding: 0 0.5rem 1rem;
}

[data-testid='snapshot'] {
    max-height: 2rem;
    overflow: hidden;
    font: 11px monospace;
}
</style>
