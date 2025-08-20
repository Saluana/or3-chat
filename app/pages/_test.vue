<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <div class="flex flex-col h-full relative">
                <div class="p-2 flex flex-col space-y-2">
                    <UButton class="w-full flex items-center justify-center"
                        >New Chat</UButton
                    >
                    <UInput
                        icon="i-lucide-search"
                        size="md"
                        variant="outline"
                        placeholder="Search..."
                        class="w-full ml-[1px]"
                    ></UInput>
                </div>
                <div class="flex flex-col p-2 space-y-1.5">
                    <RetroGlassBtn>Chat about tacos</RetroGlassBtn>
                    <UButton
                        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
                        >Chat about aids</UButton
                    >
                    <UButton
                        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
                        >Chat about dogs</UButton
                    >
                </div>
                <sidebar-side-bottom-nav />
            </div>
        </template>

        <!-- Default slot = main content (right side) -->
        <div class="h-screen overflow-y-scroll">
            <div
                class="ml-5 mt-5 flex w-full md:w-[820px] h-[250px] bg-white/5 border-2 retro-shadow backdrop-blur-sm"
            ></div>

            <div class="p-6 space-y-4">
                <div class="flex flex-row space-x-2">
                    <UButton @click="showToast" size="sm" color="primary"
                        >Nuxt UI Button</UButton
                    >
                    <UButton color="success">Nuxt UI Button</UButton>
                    <UButton size="lg" color="warning">Nuxt UI Button</UButton>
                </div>
                <div class="flex flex-row space-x-2">
                    <UButtonGroup size="lg">
                        <UButton @click="showToast" color="primary"
                            >Nuxt UI Button</UButton
                        >
                        <UButton color="success">Nuxt UI Button</UButton>
                        <UButton color="warning">Nuxt UI Button</UButton>
                    </UButtonGroup>
                    <UButtonGroup orientation="vertical" size="lg">
                        <UButton @click="showToast" color="primary"
                            >Nuxt UI Button</UButton
                        >
                        <UButton color="success">Nuxt UI Button</UButton>
                        <UButton color="warning">Nuxt UI Button</UButton>
                    </UButtonGroup>
                </div>

                <div class="flex space-x-2">
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="sm"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="md"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="lg"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                </div>

                <div class="flex items-center gap-3">
                    <button
                        class="px-3 py-1.5 rounded border text-sm bg-[var(--md-primary)] text-[var(--md-on-primary)] border-[var(--md-outline)]"
                        @click="toggle()"
                    >
                        Toggle Light/Dark
                    </button>
                    <span class="text-[var(--md-on-surface)]"
                        >Current: {{ theme }}</span
                    >
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div
                        class="p-4 rounded bg-[var(--md-surface)] text-[var(--md-on-surface)] border border-[var(--md-outline-variant)]"
                    >
                        Surface / On-Surface
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]"
                    >
                        Secondary Container
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]"
                    >
                        Tertiary Container
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-error-container)] text-[var(--md-on-error-container)]"
                    >
                        Error Container
                    </div>
                </div>

                <chat-input-dropper />
            </div>
        </div>
    </resizable-sidebar-layout>
</template>

<script setup lang="ts">
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';

const nuxtApp = useNuxtApp();
const theme = computed(() => (nuxtApp.$theme as any).get());
const toggle = () => (nuxtApp.$theme as any).toggle();
const toast = useToast();

function showToast() {
    toast.add({
        title: 'Success',
        description: 'Your action was completed successfully.',
        color: 'success',
    });
}
</script>
