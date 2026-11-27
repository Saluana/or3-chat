<template>
    <div v-if="eligible" class="mt-3 space-y-3">
        <UButton v-if="!preview && !accepted" variant="soft" @click="prepareReport">Preview report to site admin</UButton>
        <div v-if="preview" class="space-y-2">
            <p class="text-sm">Only the site administrator can read this report. It won’t include your messages, attachments, keys, or links.</p>
            <pre aria-label="Report preview" class="max-w-full overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(preview, null, 2) }}</pre>
            <div class="flex flex-wrap gap-2">
                <UButton :loading="sending" :disabled="sending || accepted || !online" @click="sendReport">Send to site admin</UButton>
                <UButton variant="ghost" :disabled="sending" @click="preview = null">Close preview</UButton>
            </div>
        </div>
        <p v-if="notice" aria-live="polite" class="text-sm">{{ notice }}</p>
        <p v-else-if="preview && !online" class="text-sm">Reconnect to send this report.</p>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useOnline } from '@vueuse/core';
import { useRuntimeConfig } from '#imports';
import { CHAT_REPORT_INTENT, CHAT_REPORT_PATH, type ChatReport } from '~~/shared/diagnostics/chat-report';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import type { ErrorToastDetails } from '~/utils/errors';

const props = defineProps<{ details: ErrorToastDetails }>();
const { public: config } = useRuntimeConfig();
const { data } = useSessionContext({ autoLoad: false });
const account = computed(() => {
    const session = data.value?.session;
    return session?.authenticated && session.user?.id ? JSON.stringify([session.provider, session.user.id]) : null;
});
const eligible = computed(() => config.errorReportingEnabled && config.ssrAuthEnabled && Boolean(account.value && props.details.chatStage));
const online = useOnline();
const preview = ref<ChatReport | null>(null);
const notice = ref('');
const sending = ref(false);
const accepted = ref(false);
let revision = 0;
let receiptId: string | undefined;

watch([() => props.details, account], () => {
    notice.value = preview.value && !accepted.value ? 'The account or error changed. Open Details again for the current report.' : '';
    preview.value = null;
    accepted.value = false;
    sending.value = false;
    revision++;
    receiptId = undefined;
}, { flush: 'sync' });

function prepareReport() {
    const { chatStage, code, source, status, router, retryable, diagnostics } = props.details;
    if (!eligible.value || !chatStage) return;
    // This explicit selection is the entire report. Never serialize an error
    // object or the larger copyable diagnostics into the request.
    preview.value = {
        id: receiptId ??= crypto.randomUUID(),
        code, source, stage: chatStage,
        status: Number.isInteger(status) ? status : undefined, router, retryable,
        checkpoint: diagnostics?.checkpoint,
        online: diagnostics?.online,
    };
    notice.value = '';
    accepted.value = false;
}

async function sendReport() {
    const report = preview.value;
    const scope = account.value;
    if (!eligible.value || !report || !scope || sending.value || accepted.value || !online.value) return;
    const target = revision;
    sending.value = true;
    notice.value = '';
    try {
        const response = await $fetch<{ accepted: true }>(CHAT_REPORT_PATH, {
            method: 'POST',
            body: report,
            headers: { 'x-or3-cloud-intent': CHAT_REPORT_INTENT, 'x-or3-account': scope },
            retry: 0,
        });
        if (revision !== target) return;
        if (!response.accepted) throw new Error('Report was not accepted');
        accepted.value = true;
        notice.value = 'Report sent to the site admin.';
    } catch {
        if (revision === target) notice.value = 'Could not confirm delivery. You can try again or copy the diagnostics instead.';
    } finally {
        if (revision === target) sending.value = false;
    }
}
</script>
