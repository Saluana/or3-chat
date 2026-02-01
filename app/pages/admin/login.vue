<template>
    <div class="min-h-screen flex items-center justify-center bg-[var(--md-surface)] px-4 py-12">
        <div class="w-full max-w-md">
            <!-- Login Card -->
            <div class="rounded-[var(--md-sys-shape-corner-large,16px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] shadow-[var(--md-elevation-3)] overflow-hidden">
                <!-- Header Section with subtle gradient -->
                <div class="bg-[var(--md-primary-container)]/30 p-8 text-center">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--md-primary)] mb-4">
                        <UIcon :name="shieldIcon" class="w-8 h-8 text-[var(--md-on-primary)]" />
                    </div>
                    <h1 class="text-2xl font-semibold text-[var(--md-on-surface)]">Admin Login</h1>
                    <p class="text-sm text-[var(--md-on-surface-variant)] mt-1">
                        Sign in to access the admin dashboard
                    </p>
                </div>

                <!-- Form Section -->
                <div class="p-8">
                    <form @submit.prevent="handleLogin" class="space-y-5">
                        <!-- Username Field -->
                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-[var(--md-on-surface)]">
                                Username
                            </label>
                            <UInput
                                v-model="username"
                                type="text"
                                placeholder="Enter username"
                                :icon="userIcon"
                                size="lg"
                                class="w-full"
                                :disabled="isLoading"
                            />
                        </div>

                        <!-- Password Field -->
                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-[var(--md-on-surface)]">
                                Password
                            </label>
                            <UInput
                                v-model="password"
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
                            class="mt-2"
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
                                class="mt-4"
                            />
                        </Transition>
                    </form>
                </div>
            </div>

            <!-- Back to App Link -->
            <div class="text-center mt-6">
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

        // Redirect to workspaces page
        router.push('/admin/workspaces');
    } catch (err: any) {
        error.value = getMessage(err, 'Login failed');
    } finally {
        isLoading.value = false;
    }
}
</script>
