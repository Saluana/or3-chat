<template>
    <div v-if="warnings.length" class="space-y-3">
        <UAlert
            v-if="hasStorageNotice"
            color="neutral"
            variant="soft"
            role="status"
            title="Deleted files still use storage"
        >
            <template #description>
                <p>
                    Files moved to Trash remain on the server. Permanent server cleanup
                    is not available yet. You can continue using OR3 normally; check storage
                    usage if space becomes a concern.
                </p>
                <UButton
                    v-if="canViewStorageUsage"
                    to="/admin/system#storage-usage"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    class="mt-3"
                >
                    View storage usage
                </UButton>
                <details class="mt-3 text-xs">
                    <summary class="cursor-pointer">Technical details</summary>
                    <p class="mt-2 break-words">{{ storageCleanupMessage }}</p>
                </details>
            </template>
        </UAlert>
        <UAlert
            v-for="(warning, index) in otherWarnings"
            :key="index"
            :color="warning.level"
            variant="soft"
            role="alert"
            :title="warning.level === 'error' ? 'System error' : 'System warning'"
            :description="warning.message"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ProviderStatus, StatusResponse } from '~/composables/admin/useAdminTypes';

const props = defineProps<{
    warnings: StatusResponse['warnings'];
    storage: ProviderStatus;
}>();

const storageCleanupMessage = 'Destructive filesystem blob GC is disabled until provider-owned deletion coordination is available.';
const isStorageNotice = (warning: StatusResponse['warnings'][number]) =>
    props.storage.provider === 'fs' && warning.message === storageCleanupMessage;
const hasStorageNotice = computed(() => props.warnings.some(isStorageNotice));
const otherWarnings = computed(() => props.warnings.filter(warning => !isStorageNotice(warning)));
const canViewStorageUsage = computed(() => props.storage.enabled &&
    props.storage.actions?.some(action => action.id === 'storage.usage'));
</script>
