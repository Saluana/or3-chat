<template>
    <AppModal :open="Boolean(databaseRecovery)" title="Workspace storage upgrade" :dismissible="false">
        <p role="status" class="mb-4">
            {{ databaseRecovery?.phase === 'blocked'
                ? 'Close other OR3 tabs to finish upgrading this workspace. Your saved data is unchanged.'
                : 'The storage upgrade could not finish. Your saved data is unchanged. Free some device storage, then retry. Do not clear this site’s data.' }}
        </p>
        <template #footer>
            <UButton v-if="databaseRecovery?.phase === 'failed'" :loading="retryingDatabase" @click="retryDatabase">Retry upgrade</UButton>
        </template>
    </AppModal>
    <OpenRouterKeyModal v-if="keyActivated" v-model:open="keyOpen" />
    <AppModal v-model:open="signInOpen" title="Sign in to OR3">
        <p class="mb-4">Use your OR3 account to continue.</p>
        <component :is="authComponent" v-if="authComponent" />
    </AppModal>
    <AppModal
        :open="Boolean(details)"
        @after:leave="finishRecovery"
        title="Error details"
        @update:open="details = null"
    >
        <p class="mb-3 text-sm">
            Technical information to help diagnose this problem.
        </p>
        <pre
            class="max-w-full overflow-auto whitespace-pre-wrap break-all text-xs"
            >{{ JSON.stringify(details, null, 2) }}</pre
        >
        <template #footer>
            <UButton v-if="detailsAction" @click="recoverDetails">{{
                labels[detailsAction]
            }}</UButton>
            <UButton variant="ghost" @click="details = null">Close</UButton>
        </template>
    </AppModal>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { databaseRecovery } from '~/db/client';
import { useRuntimeConfig, navigateTo } from '#imports';
import { setErrorRecoveryApi } from '~/utils/errors';
import { resolveAuthUiAdapter } from '~/core/auth-ui/registry';
import {
    presentError,
    type RecoveryAction,
    type ErrorMetadata,
} from '~~/shared/errors';
import AppModal from '~/components/ui/AppModal.vue';
import OpenRouterKeyModal from '~/components/chat/OpenRouterKeyModal.vue';

const retryingDatabase = ref(false);
async function retryDatabase() {
    const state = databaseRecovery.value;
    if (!state || retryingDatabase.value) return;
    retryingDatabase.value = true;
    try { await state.db.open(); window.location.reload(); }
    catch { /* The database owner retains the recoverable failure state. */ }
    finally { retryingDatabase.value = false; }
}

const config = useRuntimeConfig();
const keyOpen = ref(false);
const keyActivated = ref(false);
const signInOpen = ref(false);
const details = ref<ErrorMetadata | null>(null);
const authComponent = computed(
    () =>
        resolveAuthUiAdapter(String(config.public.authProvider ?? ''))
            ?.component,
);
const canUsePersonalKey =
    config.public.openRouter?.allowUserOverride !== false ||
    config.public.openRouter?.requireUserKey === true;
const labels = {
    update_key: 'Update API key',
    sign_in: 'Sign in',
    add_credits: 'Add credits',
};
const recovery = computed<Partial<Record<RecoveryAction, () => void>>>(() => ({
    ...(canUsePersonalKey
        ? {
              update_key: () => {
                  keyActivated.value = true;
                  keyOpen.value = true;
              },
              add_credits: () => {
                  window.open(
                      'https://openrouter.ai/credits',
                      '_blank',
                      'noopener,noreferrer',
                  );
              },
          }
        : {}),
    ...(config.public.ssrAuthEnabled &&
    (authComponent.value || window.location.pathname.startsWith('/admin'))
        ? {
              sign_in: () => {
                  if (window.location.pathname.startsWith('/admin'))
                      void navigateTo('/admin/login');
                  else signInOpen.value = true;
              },
          }
        : {}),
}));
const detailsAction = computed(() => {
    const action = details.value
        ? presentError(details.value).action
        : undefined;
    return action && recovery.value[action] ? action : undefined;
});
let pendingRecovery: RecoveryAction | undefined;
function recoverDetails() {
    pendingRecovery = detailsAction.value;
    details.value = null;
}
function finishRecovery() {
    const action = pendingRecovery;
    pendingRecovery = undefined;
    if (action) recovery.value[action]?.();
}
onMounted(() => {
    setErrorRecoveryApi({
        ...recovery.value,
        details: (metadata) => {
            details.value = metadata;
        },
    });
});
onUnmounted(() => setErrorRecoveryApi({}));
</script>
