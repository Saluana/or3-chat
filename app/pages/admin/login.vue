<template>
    <div class="min-h-screen w-full overflow-x-hidden flex items-center justify-center bg-[var(--md-surface)] px-4! py-8! sm:py-12!">
        <div class="w-full min-w-0 max-w-md">
            <!-- Login Card -->
            <div class="w-full min-w-0 max-w-[calc(100vw-2rem)] rounded-[var(--md-sys-shape-corner-large,16px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] shadow-[var(--md-elevation-3)] overflow-hidden">
                <!-- Header Section with subtle gradient -->
                <div class="bg-[var(--md-primary-container)]/30 p-4! text-center sm:p-8!">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--md-primary)] mb-4">
                        <UIcon :name="shieldIcon" class="w-8 h-8 text-[var(--md-on-primary)]" />
                    </div>
                    <h1 class="text-2xl font-semibold text-[var(--md-on-surface)]">Admin Login</h1>
                    <p class="text-sm text-[var(--md-on-surface-variant)] mt-1">
                        Sign in to access the admin dashboard
                    </p>
                </div>

                <!-- Form Section -->
                <div class="min-w-0 p-4! sm:p-8!">
                    <form @submit.prevent="handleLogin" class="flex flex-col gap-5!">
                        <!-- Username Field -->
                        <div class="flex flex-col gap-2!">
                            <label for="admin-username" class="block text-sm font-medium text-[var(--md-on-surface)]">
                                Username
                            </label>
                            <UInput
                                v-model="username"
                                id="admin-username"
                                name="username"
                                autocomplete="username"
                                type="text"
                                placeholder="Enter username"
                                :icon="userIcon"
                                size="lg"
                                class="w-full"
                                :disabled="isLoading"
                            />
                        </div>

                        <!-- Password Field -->
                        <div class="flex flex-col gap-2!">
                            <label for="admin-password" class="block text-sm font-medium text-[var(--md-on-surface)]">
                                Password
                            </label>
                            <UInput
                                v-model="password"
                                id="admin-password"
                                name="password"
                                autocomplete="current-password"
                                type="password"
                                placeholder="Enter password"
                                :icon="lockIcon"
                                size="lg"
                                class="w-full"
                                :disabled="isLoading"
                            />
                        </div>

                        <!-- Submit Button -->
                        <UButton
                            type="submit"
                            block
                            size="lg"
                            color="primary"
                            :loading="isLoading"
                            :disabled="!username || !password || isLoading"
                            class="mt-2!"
                        >
                            <UIcon :name="loginIcon" class="w-5 h-5 mr-2" />
                            Sign In
                        </UButton>

                        <!-- Error Alert -->
                        <Transition
                            enter-active-class="transition-all duration-200 ease-out"
                            enter-from-class="opacity-0 -translate-y-2"
                            enter-to-class="opacity-100 translate-y-0"
                            leave-active-class="transition-all duration-150 ease-in"
                            leave-from-class="opacity-100 translate-y-0"
                            leave-to-class="opacity-0 -translate-y-2"
                        >
                            <UAlert
                                v-if="error"
                                color="error"
                                variant="soft"
                                :title="error"
                                :icon="warningIcon"
                                class="mt-4!"
                            />
                        </Transition>
                    </form>
                </div>
            </div>

            <!-- Back to App Link -->
            <div class="mt-6! text-center">
                <NuxtLink
                    to="/"
                    class="text-sm text-[var(--md-on-surface-variant)] hover:text-[var(--md-primary)] transition-colors inline-flex items-center gap-1"
                >
                    <UIcon :name="arrowLeftIcon" class="w-4 h-4" />
                    Back to application
                </NuxtLink>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
definePageMeta({
    layout: false,
});

type AdminSessionKind = 'super_admin' | 'workspace_admin';

function resolveAdminLanding(kind: AdminSessionKind): string {
    return kind === 'super_admin' ? '/admin' : '/admin/plugins';
}

const router = useRouter();
const toast = useToast();
const { getMessage } = useApiError();

// Icon tokens
const shieldIcon = useIcon('ui.shield');
const userIcon = useIcon('sidebar.user');
const lockIcon = useIcon('ui.lock');
const loginIcon = useIcon('ui.login');
const warningIcon = useIcon('ui.warning');
const arrowLeftIcon = useIcon('ui.arrow.left');

const username = ref('');
const password = ref('');
const isLoading = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
    try {
        const session = await $fetch<{ authenticated: boolean; kind: AdminSessionKind }>(
            '/api/admin/auth/session',
            {
                credentials: 'include',
                cache: 'no-store',
            }
        );

        if (session.authenticated) {
            await router.replace(resolveAdminLanding(session.kind));
        }
    } catch {
        // No active admin session; stay on the login page.
    }
});

async function handleLogin() {
    if (!username.value || !password.value) return;

    isLoading.value = true;
    error.value = null;

    try {
        await $fetch('/api/admin/auth/login', {
            method: 'POST',
            body: {
                username: username.value,
                password: password.value,
            },
        });

        toast.add({
            title: 'Login successful',
            description: 'Redirecting to admin dashboard...',
            color: 'success',
        });

        await router.push('/admin');
    } catch (err: unknown) {
        error.value = getMessage(err, 'Login failed');
    } finally {
        isLoading.value = false;
    }
}
</script>
