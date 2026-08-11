<template>
    <SignedIn>
        <div
            v-if="isMoreSheetLayout"
            class="more-row more-row--clerk-account"
        >
            <span class="more-row-icon more-row-icon--admin" aria-hidden="true">
                <UserButton
                    :appearance="{
                        elements: {
                            avatarBox: 'w-full h-full rounded-[inherit]',
                            userButtonTrigger: 'p-0 w-full h-full focus:shadow-none',
                            userButtonAvatarBox: 'w-full h-full',
                            userButtonPopoverRootBox: '!z-[100]',
                            userButtonPopoverCard: '!z-[100]',
                        },
                    }"
                />
            </span>
            <span class="more-row-copy">
                <span class="more-row-label">Account</span>
                <span class="more-row-desc">Manage your profile & settings</span>
            </span>
            <UIcon
                :name="iconChevron"
                class="more-row-chevron"
                aria-hidden="true"
            />
        </div>
        <div
            v-else
            class="h-[54px] w-[54px] flex items-center justify-center cursor-pointer rounded-[var(--md-border-radius-small,var(--md-border-radius))] hover:bg-[var(--md-surface-hover)]! transition-colors"
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
            <button
                v-if="isMoreSheetLayout"
                type="button"
                class="more-row"
                aria-label="Sign In"
            >
                <span
                    class="more-row-icon more-row-icon--admin"
                    aria-hidden="true"
                >
                    <UIcon :name="iconUser" />
                </span>
                <span class="more-row-copy">
                    <span class="more-row-label">Login</span>
                    <span class="more-row-desc"
                        >Manage your profile & settings</span
                    >
                </span>
                <UIcon
                    :name="iconChevron"
                    class="more-row-chevron"
                    aria-hidden="true"
                />
            </button>
            <UButton
                v-else
                v-bind="buttonProps"
                type="button"
                aria-label="Sign In"
            >
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full">
                        <UIcon :name="iconUser" class="h-[18px] w-[18px]" />
                        <span
                            class="sidebar-rail-caption text-[7px] uppercase tracking-wider whitespace-nowrap"
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
import { computed, inject, unref } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

const props = defineProps<{
    layout?: 'rail' | 'more-sheet';
}>();

const iconUser = useIcon('sidebar.user');
const iconChevron = useIcon('ui.chevron.right');

const injectedLayout = inject<string | null>('or3:auth-ui-layout', null);
const isMoreSheetLayout = computed(
    () =>
        props.layout === 'more-sheet' ||
        (injectedLayout ? unref(injectedLayout) : 'rail') === 'more-sheet'
);

const buttonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.auth',
        state: 'ssr',
        isNuxtUI: true,
    });

    return {
        block: true,
        ...overrides.value,
    };
});
</script>

<!-- Clerk teleports account UI outside this component. Keep its portals above
     the mobile More sheet (z-index: 80) without lowering the sheet itself. -->
<style>
.cl-userButtonPopoverRootBox,
.cl-userButtonPopoverCard,
.cl-modalBackdrop,
.cl-modalContent {
    z-index: 100 !important;
}
</style>
