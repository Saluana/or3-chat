<template>
    <div class="space-y-4">
        <div>
            <h1 class="text-2xl font-semibold">Chat diagnostic reports</h1>
            <p class="text-sm opacity-70">These reports were sent by users. They describe what their browser saw, not what the server confirmed.</p>
        </div>
        <UButton variant="soft" :loading="status === 'pending'" @click="refresh()">Refresh</UButton>
        <UAlert v-if="error" color="warning" title="Reports unavailable" description="Reporting is disabled, this account is not the site admin, or the inbox could not be opened." />
        <p v-else-if="status !== 'pending' && !data?.reports.length" class="text-sm">No reports have been submitted.</p>
        <div v-else class="space-y-2">
            <details v-for="report in data?.reports" :key="report.id" class="rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] p-3">
                <summary class="cursor-pointer">
                    {{ report.code }} · {{ report.stage === 'after_save' ? 'After message was saved' : 'Before save was confirmed' }}
                    <time :datetime="new Date(report.receivedAt).toISOString()" class="text-xs opacity-70">{{ new Date(report.receivedAt).toISOString() }}</time>
                </summary>
                <pre class="mt-2 whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(report, null, 2) }}</pre>
            </details>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { StoredChatReport } from '~~/shared/diagnostics/chat-report';

definePageMeta({ layout: 'admin', middleware: ['admin-auth'] });
const { data, error, refresh, status } = useFetch<{ reports: StoredChatReport[] }>('/api/admin/chat-reports', { server: false });
</script>
