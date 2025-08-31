<template>
    <div v-if="effectiveThreads.length > 0" class="mt-4">
        <div class="flex items-center justify-between px-1 mb-1">
            <h4 class="text-xs uppercase tracking-wide opacity-70 select-none">
                Chats
            </h4>
            <UTooltip text="New Chat" :delay-duration="0">
                <UButton
                    icon="pixelarticons:chat-plus"
                    size="xs"
                    variant="subtle"
                    @click="$emit('new-chat')"
                />
            </UTooltip>
        </div>
        <div v-if="loading" class="text-xs opacity-60 px-1 py-2">Loading…</div>
        <div
            v-else-if="effectiveThreads.length === 0"
            class="text-xs opacity-60 px-1 py-2"
        >
            No chats
        </div>
        <div v-else class="space-y-2">
            <RetroGlassBtn
                v-for="t in effectiveThreads"
                :key="t.id"
                class="w-full flex items-center justify-between text-left"
                :class="{
                    'active-element bg-primary/25': t.id === activeThread,
                }"
                @click="$emit('select', t.id)"
            >
                <div
                    class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                >
                    <UIcon
                        v-if="t.forked"
                        name="pixelarticons:git-branch"
                        class="shrink-0"
                    />
                    <span
                        class="truncate flex-1 min-w-0"
                        :title="t.title || 'New Thread'"
                        >{{ t.title || 'New Thread' }}</span
                    >
                </div>
                <!-- Actions popover -->
                <UPopover
                    :content="{ side: 'right', align: 'start', sideOffset: 6 }"
                >
                    <span
                        class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                        @click.stop
                    >
                        <UIcon
                            name="pixelarticons:more-vertical"
                            class="w-4 h-4 opacity-70"
                        />
                    </span>
                    <template #content>
                        <div class="p-1 w-44 space-y-1">
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-pencil"
                                @click="$emit('rename-thread', t)"
                                >Rename</UButton
                            >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="pixelarticons:folder-plus"
                                @click="$emit('add-to-project', t)"
                                >Add to project</UButton
                            >
                            <UButton
                                color="error"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-trash-2"
                                @click="$emit('delete-thread', t)"
                                >Delete</UButton
                            >
                            <!-- Dynamically registered plugin actions -->
                            <template
                                v-for="action in extraActions"
                                :key="action.id"
                            >
                                <UButton
                                    :icon="action.icon"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    class="w-full justify-start"
                                    @click="() => runExtraAction(action, t)"
                                    >{{ action?.tooltip || '' }}</UButton
                                >
                            </template>
                        </div>
                    </template>
                </UPopover>
            </RetroGlassBtn>
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { liveQuery } from 'dexie';
import { db } from '~/db';
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';

const props = defineProps<{
    activeThread?: string;
    externalThreads?: any[];
    limit?: number;
}>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'new-chat'): void;
    (e: 'add-to-project', thread: any): void;
    (e: 'delete-thread', thread: any): void;
    (e: 'rename-thread', thread: any): void;
}>();

const loading = ref(true);
const threads = ref<any[]>([]);

// Live query for threads
let sub: { unsubscribe: () => void } | null = null;

if (!props.externalThreads) {
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .limit(props.limit || 200)
            .toArray()
    ).subscribe({
        next: (results) => {
            threads.value = results;
            loading.value = false;
        },
        error: (err) => {
            console.error('threads liveQuery error', err);
            loading.value = false;
        },
    });
} else {
    loading.value = false;
}

const effectiveThreads = computed(() =>
    Array.isArray(props.externalThreads) ? props.externalThreads : threads.value
);

// Extensible thread actions (plugin registered)
const extraActions = useMessageActions({ role: 'assistant' }); // Use assistant actions as default

async function runExtraAction(action: any, thread: any) {
    try {
        await action.handler({
            message: thread, // Adapt to message interface
            threadId: thread.id,
        });
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        console.error('Thread action error', action.id, e);
    }
}

// Cleanup
import { onUnmounted } from 'vue';
onUnmounted(() => {
    if (sub) sub.unsubscribe();
});
</script>
