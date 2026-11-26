<template>
    <AppModal :open="Boolean(databaseRecovery)" title="Workspace storage upgrade" :dismissible="false">
        <div role="status" aria-live="polite" aria-atomic="true" class="space-y-4">
            <p v-if="databaseRecovery?.phase === 'upgrading'">
                Updating local data. Keep this tab open until your workspace is ready.
            </p>
            <p v-else-if="databaseRecovery?.phase === 'blocked'">
                Close other OR3 tabs to finish upgrading this workspace. Your saved data is unchanged.
            </p>
            <p v-else>
                The storage upgrade could not finish. Your saved data is unchanged. Free some device storage, then retry. Do not clear this site’s data.
            </p>
            <UProgress v-if="databaseRecovery?.phase === 'upgrading'" :model-value="null" aria-label="Updating local data" />
        </div>
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
        <p v-if="details?.chatStage" class="mb-3 text-sm">
            {{ details.chatStage === 'after_save' ? 'The message was saved. The reply did not finish.' : 'OR3 could not confirm the message was saved.' }}
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
import { setErrorRecoveryApi, type ErrorToastDetails } from '~/utils/errors';
import { resolveAuthUiAdapter } from '~/core/auth-ui/registry';
import {
    presentError,
    type RecoveryAction,
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
const details = ref<ErrorToastDetails | null>(null);
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
