<template>
    <!-- Adapter registration is client-only, including custom full-page adapters. -->
    <ClientOnly>
        <component
            :is="lockPageComponent"
            v-if="customAdapterOwnsPage"
            :access-reason="access.reason"
            :error-message="access.errorMessage"
        />
        <LockPageShell v-else>
            <component
                :is="lockPageComponent"
                :access-reason="access.reason"
                :error-message="access.errorMessage"
            />
        </LockPageShell>
        <template #fallback>
            <LockPageShell />
        </template>
    </ClientOnly>
</template>

<script setup lang="ts">
definePageMeta({
    layout: false,
});

import { computed } from 'vue';
import { navigateTo, useRoute } from '#imports';
import DefaultLockPage from '~/components/lock-page/DefaultLockPage.vue';
import LockPageShell from '~/components/lock-page/LockPageShell.vue';
import { resolveLockPageAccess } from '~/core/lock-page/access';
import {
    resolveLockPageAdapter,
    resolveRuntimeLockPageComponent,
} from '~/core/lock-page/registry';
import {
    resolvePostAuthRedirectTarget,
    useLockPageRuntimeConfig,
} from '~/core/lock-page/runtime';

const route = useRoute();
const lockPageConfig = useLockPageRuntimeConfig();
const access = await resolveLockPageAccess();

if (access.allowed) {
    await navigateTo(
        resolvePostAuthRedirectTarget(route.query.next, lockPageConfig.route),
        { replace: true }
    );
}

const customAdapterOwnsPage = computed(
    () =>
        access.reason !== 'session-error' &&
        lockPageConfig.adapter.toLowerCase() !== 'default' &&
        resolveLockPageAdapter(lockPageConfig.adapter) !== null
);

const lockPageComponent = computed(() =>
    access.reason === 'session-error'
        ? DefaultLockPage
        : resolveRuntimeLockPageComponent({
              adapterId: lockPageConfig.adapter,
              authProviderId: lockPageConfig.authProvider,
              fallback: DefaultLockPage,
          })
);
</script>
