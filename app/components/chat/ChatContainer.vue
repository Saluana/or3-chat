<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <div
            class="absolute w-full h-screen overflow-y-scroll sm:pt-3.5 pb-[165px]"
        >
            <div
                class="mx-auto flex w-full px-1.5 sm:px-0 sm:max-w-[768px] flex-col space-y-12 pb-10 pt-safe-offset-10"
            >
                <ChatMessage
                    v-for="(message, index) in messages || []"
                    :key="
                        message.id ||
                        message.stream_id ||
                        `${index}-${message.role}`
                    "
                    :message="message"
                />
            </div>
        </div>
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center pr-0.5 sm:pr-[11px]"
            >
                <chat-input-dropper
                    :loading="loading"
                    @send="onSend"
                    @model-change="onModelChange"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import ChatMessage from './ChatMessage.vue';
import { shallowRef, computed, watch, ref } from 'vue';
import { useChat } from '~/composables/useAi';
import type {
    ChatMessage as ChatMessageType,
    ContentPart,
} from '~/composables/useAi';

const model = ref('openai/gpt-oss-120b');

function onModelChange(newModel: string) {
    model.value = newModel;
    console.log('Model changed to:', newModel);
}

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessageType[];
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(useChat(props.messageHistory, props.threadId));

watch(
    () => props.threadId,
    (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) return;
        chat.value = useChat(props.messageHistory, newId);
    }
);

// Keep composable messages in sync when parent provides an updated messageHistory
watch(
    () => props.messageHistory,
    (mh) => {
        if (!chat.value) return;
        // While streaming, don't clobber the in-flight assistant placeholder with stale DB content
        if (chat.value.loading.value) return;
        // Prefer to update the internal messages array directly to avoid remount flicker
        chat.value.messages.value = [...(mh || [])];
    }
);

// When a new thread id is created internally (first send), propagate upward once
watch(
    () => chat.value?.threadId?.value,
    (id, prev) => {
        if (!prev && id) emit('thread-selected', id);
    }
);

// Render messages with content narrowed to string for ChatMessage.vue
type RenderMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
};
const messages = computed<RenderMessage[]>(() =>
    (chat.value.messages.value || []).map((m: ChatMessageType & any) => {
        let contentStr: string;
        if (typeof m.content === 'string') contentStr = m.content;
        else if (Array.isArray(m.content)) {
            contentStr = (m.content as ContentPart[])
                .map((p) => {
                    if (p.type === 'text') return p.text;
                    if (p.type === 'image')
                        return `![image](${(p as any).image ?? ''})`;
                    if (p.type === 'file')
                        return `**[file:${
                            (p as any).name ?? (p as any).mediaType ?? 'file'
                        }]**`;
                    return '';
                })
                .filter(Boolean)
                .join('\n\n');
        } else contentStr = String((m as any).content ?? '');
        return {
            role: m.role,
            content: contentStr,
            id: m.id,
            stream_id: m.stream_id,
        } as RenderMessage;
    })
);
const loading = computed(() => chat.value.loading.value);

function onSend(payload: any) {
    console.log('[ChatContainer.onSend] raw payload', payload);
    if (loading.value) return; // prevent duplicate sends while streaming

    let reqParams: any = {
        files: [],
        model: model.value,
    };

    if (payload.images && payload.images.length > 0) {
        const inferType = (url: string, provided?: string) => {
            if (provided && provided.startsWith('image/')) return provided;
            const m = /^data:([^;]+);/i.exec(url);
            if (m) return m[1];
            const lower = (url.split('?')[0] || '').toLowerCase();
            const ext = lower.substring(lower.lastIndexOf('.') + 1);
            const map: Record<string, string> = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                webp: 'image/webp',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                avif: 'image/avif',
                heic: 'image/heic',
                heif: 'image/heif',
                bmp: 'image/bmp',
                tif: 'image/tiff',
                tiff: 'image/tiff',
                ico: 'image/x-icon',
            };
            return map[ext] || 'image/png';
        };
        reqParams.files = payload.images.map((p: any, i: number) => {
            const url: string = p.url;
            const preview = (url || '').slice(0, 60);
            const mime = inferType(url, p.type);
            console.log('[ChatContainer.onSend] image found', {
                index: i,
                preview,
                mime,
            });
            return { url, type: mime };
        });
    }

    console.log('[ChatContainer.onSend] transformed reqParams', reqParams);

    chat.value
        .sendMessage(payload.text, reqParams as any)
        .then(() => {
            console.log('[ChatContainer.onSend] sendMessage resolved', {
                messageCount: chat.value.messages.value.length,
                lastMessage:
                    chat.value.messages.value[
                        chat.value.messages.value.length - 1
                    ],
            });
        })
        .catch((e: any) => {
            console.error('[ChatContainer.onSend] sendMessage error', e);
        });
}
</script>

<style></style>
