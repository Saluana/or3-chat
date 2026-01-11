<template>
    <SignedIn>
        <div
            class="h-[54px] w-[54px] flex items-center justify-center cursor-pointer rounded-[var(--md-border-radius)] hover:bg-[var(--md-surface-hover)]! transition-colors"
        >
            <UserButton
                :appearance="{
                    elements: {
                        avatarBox: 'w-[32px] h-[32px]',
                        userButtonTrigger: 'p-0 focus:shadow-none',
                    },
                }"
            />
        </div>
    </SignedIn>

    <SignedOut>
        <SignInButton mode="modal">
            <UButton v-bind="buttonProps" type="button" aria-label="Sign In">
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full">
                        <UIcon :name="iconUser" class="h-[18px] w-[18px]" />
                        <span
                            class="text-[7px] uppercase tracking-wider whitespace-nowrap"
                        >
                            Login
                        </span>
                    </span>
                </template>
            </UButton>
        </SignInButton>
    </SignedOut>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

const iconUser = useIcon('sidebar.user');

const buttonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.auth',
        state: 'ssr',
        isNuxtUI: true,
    });

    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...overrides.value,
    };
});
</script>
