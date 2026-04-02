<template>
    <div class="flex h-full min-h-0 flex-col gap-3 p-3">
        <div class="flex flex-wrap items-center justify-between gap-3 border-2 border-(--md-border-color) bg-(--md-surface) p-3 text-sm">
            <div class="min-w-0">
                <div class="font-medium truncate">{{ paneTitle }}</div>
                <div class="text-xs opacity-70">
                    {{ paneSubtitle }}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    class="retro-btn"
                    :disabled="pendingAction === 'open' || !canOpenNewTab"
                    @click="openInNewTab"
                >
                    {{ pendingAction === 'open' ? 'Opening…' : 'Open in New Tab' }}
                </UButton>
                <UButton
                    class="retro-btn"
                    :disabled="pendingAction === 'refresh'"
                    @click="refreshPreview"
                >
                    {{ pendingAction === 'refresh' ? 'Refreshing…' : 'Refresh' }}
                </UButton>
                <UButton
                    class="retro-btn"
                    :disabled="pendingAction === 'revoke'"
                    @click="revokePreview"
                >
                    {{ pendingAction === 'revoke' ? 'Revoking…' : 'Revoke' }}
                </UButton>
            </div>
        </div>

        <p v-if="message" class="text-xs opacity-70">{{ message }}</p>
        <p v-if="errorMessage" class="text-sm text-(--md-error)">{{ errorMessage }}</p>

        <div v-if="iframeUrl" class="min-h-0 flex-1 border-2 border-(--md-border-color) bg-(--md-surface)">
            <iframe
                :src="iframeUrl"
                class="h-full min-h-[420px] w-full border-0"
                title="OR3 Net Preview"
                loading="lazy"
                referrerpolicy="no-referrer"
            />
        </div>
        <div
            v-else
            class="flex min-h-[280px] flex-col items-center justify-center gap-3 border-2 border-(--md-border-color) bg-(--md-surface) p-6 text-center text-sm"
        >
            <div class="font-medium">Embedded preview unavailable</div>
            <p class="max-w-xl opacity-70">
                This preview is not marked as iframe-safe. Open it in a new tab instead of pretending an embed exists.
            </p>
            <UButton
                class="retro-btn"
                :disabled="pendingAction === 'open' || !canOpenNewTab"
                @click="openInNewTab"
            >
                {{ pendingAction === 'open' ? 'Opening…' : 'Open in New Tab' }}
            </UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { useOr3NetClient } from '~/composables/or3-net/useOr3NetClient';
import { useOr3NetPreviewPaneState } from '~/composables/or3-net/useOr3NetPreviewPaneState';

const props = defineProps<{
    paneId: string;
    recordId: string | null;
    postType: string;
    postApi: unknown;
}>();

void props.paneId;
void props.postType;
void props.postApi;

const client = useOr3NetClient();
const previewPaneState = useOr3NetPreviewPaneState();

const pendingAction = ref<'open' | 'refresh' | 'revoke' | null>(null);
const errorMessage = ref<string | null>(null);
const message = ref<string | null>(null);

const record = computed(() => previewPaneState.get(props.recordId));
const paneTitle = computed(() => record.value?.title ?? 'OR3 Net Preview');
const paneSubtitle = computed(() => {
    if (!record.value) {
        return 'Preview session unavailable';
    }

    return `${record.value.kind} · ${record.value.source_type} · expires ${formatTimestamp(record.value.expires_at)}`;
});
const iframeUrl = computed(() => record.value?.embed_url ?? null);
const canOpenNewTab = computed(() => Boolean(resolveSafeBrowserUrl(record.value?.launch_url ?? null)));

onUnmounted(() => {
    if (props.recordId) {
        previewPaneState.remove(props.recordId);
    }
});

async function openInNewTab(): Promise<void> {
    if (!record.value) return;

    pendingAction.value = 'open';
    errorMessage.value = null;
    message.value = null;
    try {
        const safeUrl = resolveSafeBrowserUrl(record.value.launch_url);
        if (!safeUrl) {
            throw new Error('Blocked non-HTTP preview launch URL');
        }
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
        message.value = 'Opened preview in a new tab.';
    } catch (cause) {
        errorMessage.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        pendingAction.value = null;
    }
}

async function refreshPreview(): Promise<void> {
    if (!record.value) return;

    pendingAction.value = 'refresh';
    errorMessage.value = null;
    message.value = null;
    try {
        const launch = await client.launchPreview(record.value.workspace_id, record.value.preview_id, {
            launch_mode_hint: 'pane',
        });
        previewPaneState.update(record.value.id, {
            launch_url: launch.launch_url,
            embed_url: launch.embed_url ?? (launch.supports_iframe ? launch.launch_url : null),
            delivery_mode: launch.delivery_mode,
            supports_iframe: launch.supports_iframe,
            supports_new_tab: launch.supports_new_tab,
            service_status: launch.service_status,
            expires_at: launch.expires_at,
        });
        message.value = `Refreshed preview. Expires ${formatTimestamp(launch.expires_at)}.`;
    } catch (cause) {
        errorMessage.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        pendingAction.value = null;
    }
}

async function revokePreview(): Promise<void> {
    if (!record.value) return;

    pendingAction.value = 'revoke';
    errorMessage.value = null;
    message.value = null;
    try {
        await client.revokePreview(record.value.workspace_id, record.value.preview_id);
        previewPaneState.update(record.value.id, {
            launch_url: '',
            embed_url: null,
            supports_iframe: false,
            supports_new_tab: false,
            service_status: 'revoked',
        });
        message.value = 'Revoked preview access.';
    } catch (cause) {
        errorMessage.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        pendingAction.value = null;
    }
}

function formatTimestamp(value: string | null | undefined): string {
    if (!value) return 'Unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function resolveSafeBrowserUrl(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}
</script>