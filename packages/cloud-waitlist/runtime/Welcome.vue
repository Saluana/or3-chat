<template>
    <LockPageShell>
        <component :is="provider" v-if="provider">
            <template v-if="status !== 'success' || data?.enabled" #email-form="{ state }">
                <WaitlistForm
                    v-model="state.email"
                    :loading="status === 'pending' || status === 'idle'"
                    :unavailable="Boolean(error)"
                    @retry="refresh()"
                    @closed="refresh()"
                />
            </template>
        </component>
        <DefaultLockPage v-else />
    </LockPageShell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useFetch } from '#imports';
import { resolveLockPageAdapter } from '~/core/lock-page/registry';
import LockPageShell from '~/components/lock-page/LockPageShell.vue';
import DefaultLockPage from '~/components/lock-page/DefaultLockPage.vue';
import WaitlistForm from './WaitlistForm.vue';

const provider = computed(() => resolveLockPageAdapter('basic-auth')?.component);
const { data, status, error, refresh } = useFetch<{ enabled: boolean }>('/api/cloud/waitlist', {
    server: false, cache: 'no-store', key: 'cloud-waitlist-mode',
});
</script>
