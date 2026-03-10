<template>
    <component :is="lockPageComponent" />
</template>

<script setup lang="ts">
definePageMeta({
    layout: false,
});

import { computed } from 'vue';
import { navigateTo, useRoute } from '#imports';
import DefaultLockPage from '~/components/lock-page/DefaultLockPage.vue';
import { resolveLockPageAccess } from '~/core/lock-page/access';
import { resolveLockPageComponent } from '~/core/lock-page/registry';
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

const lockPageComponent = computed(() =>
    resolveLockPageComponent(lockPageConfig.adapter, DefaultLockPage)
);
</script>
