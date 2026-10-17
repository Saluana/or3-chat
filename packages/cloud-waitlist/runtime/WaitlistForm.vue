<template>
    <div v-if="submitted" role="status" class="waitlist-message">
        <strong>You're on the list.</strong>
        <p>We'll let you know when there's room to join.</p>
    </div>
    <div v-else-if="unavailable" class="waitlist-message" role="alert">
        <p>The waitlist couldn't be loaded.</p>
        <UButton color="neutral" variant="outline" @click="$emit('retry')">Try again</UButton>
    </div>
    <UForm v-else :state="state" @submit="join">
        <UFormField label="Email address" name="email" :ui="{ label: 'lock-page-email-label', container: 'lock-page-email-container' }">
            <UInput
                v-model="email" type="email" name="email" placeholder="you@example.com"
                autocomplete="email" required icon="i-lucide-mail" class="w-full"
                style="padding-inline-start: var(--lock-email-inset, 1rem) !important; outline: var(--lock-email-focus, none) !important; outline-offset: 2px"
                :ui="{ base: 'lock-page-email-input', leading: 'lock-page-email-leading', leadingIcon: 'size-5' }"
            />
        </UFormField>
        <UButton
            block type="submit" color="neutral" size="xl" trailing-icon="i-lucide-arrow-right"
            class="lock-page-continue" :loading="busy || loading" :disabled="busy || loading"
            :ui="{ label: 'tracking-normal', trailingIcon: 'size-5 ms-0' }"
        >Join the waitlist</UButton>
        <p v-if="message" role="alert" class="mt-2 text-sm text-(--md-error)">{{ message }}</p>
    </UForm>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

defineProps<{ loading: boolean; unavailable: boolean }>();
const emit = defineEmits<{ retry: []; closed: [] }>();
const email = defineModel<string>({ required: true });
const state = computed(() => ({ email: email.value }));
const busy = ref(false);
const submitted = ref(false);
const message = ref('');

async function join() {
    if (busy.value) return;
    busy.value = true;
    message.value = '';
    try {
        await $fetch('/api/cloud/waitlist', {
            method: 'POST', headers: { 'x-or3-waitlist-intent': 'join' },
            body: { email: email.value.trim() },
        });
        submitted.value = true;
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 409) emit('closed');
        message.value = status === 429 ? 'Too many attempts. Please try again later.'
            : status === 400 ? 'Enter a valid email address.'
            : status === 409 ? 'The waitlist is closed. Please sign in or use an invite.'
            : "We couldn't save your email. Please try again.";
    } finally { busy.value = false; }
}
</script>

<style scoped>
.waitlist-message { min-height: 6.75rem; display: flex; flex-direction: column; justify-content: center; gap: 0.5rem; font-size: 0.9375rem; color: var(--md-on-surface); }
.waitlist-message p { color: var(--md-on-surface-variant); }
</style>
