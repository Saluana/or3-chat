<template>
    <UModal
        v-model:open="isOpen"
        :title="modalTitle"
        :description="admin ? 'Register an admin or custom server-side webhook.' : 'Register a webhook for curated workspace events.'"
        :ui="{
            overlay: 'z-[60]',
            content: 'z-[70] sm:min-w-[520px] sm:max-w-[600px]',
        }"
    >
        <template #body>
            <div class="space-y-5">
                <!-- Error banner -->
                <UAlert
                    v-if="formError"
                    color="error"
                    title="Unable to save webhook"
                    :description="formError"
                />

                <!-- Signing secret reveal (post-create) -->
                <div
                    v-if="revealedSecret"
                    class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-primary)] bg-[var(--md-primary)]/8 p-4"
                >
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="text-sm font-semibold text-[var(--md-on-surface)]">
                                Save this signing secret now
                            </div>
                            <div class="mt-0.5 text-xs text-[var(--md-on-surface)] opacity-70">
                                It is shown only once and cannot be retrieved again.
                            </div>
                        </div>
                        <UButton
                            size="sm"
                            variant="outline"
                            color="primary"
                            @click="copySecret"
                        >
                            Copy
                        </UButton>
                    </div>
                    <pre
                        class="mt-3 overflow-auto rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3 text-xs leading-relaxed text-[var(--md-on-surface)]"
                    >{{ revealedSecret }}</pre>
                </div>

                <!-- Target URL -->
                <fieldset class="space-y-1.5">
                    <label class="block text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface)] opacity-60">
                        Target URL
                    </label>
                    <UInput
                        v-model="url"
                        placeholder="https://example.com/webhooks/or3"
                    />
                    <p
                        v-if="urlValidationMessage"
                        class="text-xs text-[var(--md-error)]"
                    >
                        {{ urlValidationMessage }}
                    </p>
                </fieldset>

                <!-- Label -->
                <fieldset class="space-y-1.5">
                    <label class="block text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface)] opacity-60">
                        Label
                    </label>
                    <UInput
                        v-model="label"
                        placeholder="My webhook"
                        :maxlength="100"
                    />
                </fieldset>

                <!-- Events -->
                <fieldset class="space-y-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <label class="text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface)] opacity-60">
                            Events
                        </label>
                        <div class="flex items-center gap-1">
                            <UButton
                                size="xs"
                                variant="ghost"
                                color="neutral"
                                @click="selectAllEvents"
                            >
                                Select All
                            </UButton>
                            <UButton
                                size="xs"
                                variant="ghost"
                                color="neutral"
                                @click="selectedEvents = []"
                            >
                                Clear
                            </UButton>
                        </div>
                    </div>

                    <div
                        class="max-h-64 space-y-1.5 overflow-y-auto rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-2"
                    >
                        <label
                            v-for="item in eventOptions"
                            :key="item.value"
                            class="group flex cursor-pointer items-start gap-3 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)]/40 bg-[var(--md-surface)] px-3 py-2.5 transition-colors hover:border-[color:var(--md-primary)]/40 hover:bg-[var(--md-primary)]/5"
                            :class="selectedEvents.includes(item.value) ? 'border-[color:var(--md-primary)]/60 bg-[var(--md-primary)]/8' : ''"
                        >
                            <UCheckbox
                                :model-value="selectedEvents.includes(item.value)"
                                size="sm"
                                class="mt-0.5"
                                @update:model-value="toggleEvent(item.value)"
                            />
                            <div class="min-w-0 flex-1">
                                <div class="text-sm font-medium text-[var(--md-on-surface)]">
                                    {{ item.value }}
                                </div>
                                <div class="mt-0.5 text-xs text-[var(--md-on-surface)] opacity-60 leading-snug">
                                    {{ item.description }}
                                </div>
                            </div>
                        </label>
                    </div>
                </fieldset>

                <!-- Admin-only: custom hooks + workspace scope -->
                <template v-if="admin">
                    <details
                        class="group rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] open:bg-[var(--md-surface)]"
                    >
                        <summary class="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-[var(--md-on-surface)]">
                            Custom server-side hooks
                        </summary>
                        <div class="border-t-[length:var(--md-border-width)] border-t-[color:var(--md-outline-variant)] px-4 py-3">
                            <p class="mb-3 text-xs text-[var(--md-on-surface)] opacity-60 leading-snug">
                                Subscribe to arbitrary Nitro server hook names. Payload schemas are not guaranteed stable.
                            </p>
                            <div class="space-y-2">
                                <div
                                    v-for="(hookName, index) in customHooks"
                                    :key="`${index}:${hookName}`"
                                    class="flex items-center gap-2"
                                >
                                    <UInput
                                        :model-value="hookName"
                                        class="flex-1"
                                        size="sm"
                                        placeholder="db.messages.create:action:after"
                                        @update:model-value="updateCustomHook(index, $event)"
                                    />
                                    <UButton
                                        size="xs"
                                        variant="ghost"
                                        color="error"
                                        @click="removeCustomHook(index)"
                                    >
                                        Remove
                                    </UButton>
                                </div>
                                <UButton
                                    size="sm"
                                    variant="outline"
                                    color="neutral"
                                    @click="addCustomHook"
                                >
                                    + Add hook
                                </UButton>
                            </div>
                        </div>
                    </details>

                    <fieldset class="space-y-1.5">
                        <label class="block text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface)] opacity-60">
                            Workspace Scope
                        </label>
                        <USelectMenu
                            v-model="workspaceFilter"
                            :items="workspaceOptions"
                            value-key="value"
                            label-key="label"
                        />
                    </fieldset>
                </template>
            </div>
        </template>

        <template #footer>
            <div class="flex w-full items-center justify-between gap-3">
                <UButton
                    variant="outline"
                    color="neutral"
                    @click="closeModal"
                >
                    {{ revealedSecret && !props.webhook ? 'Done' : 'Cancel' }}
                </UButton>
                <UButton
                    color="primary"
                    :loading="saving"
                    @click="submit"
                >
                    {{ props.webhook ? 'Save Changes' : 'Create Webhook' }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import {
    ADMIN_WEBHOOK_EVENT_DESCRIPTIONS,
    ADMIN_WEBHOOK_EVENT_TYPES,
    WEBHOOK_EVENT_DESCRIPTIONS,
    WEBHOOK_EVENT_TYPES,
} from '~~/shared/webhooks/event-types';
import type {
    ManagedWebhook,
    ManagedWorkspaceOption,
} from './types';

const props = defineProps<{
    admin?: boolean;
    webhook?: ManagedWebhook | null;
    workspaces?: ManagedWorkspaceOption[];
}>();

const emit = defineEmits<{
    saved: [webhook: ManagedWebhook];
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const toast = useToast();
const { getMessage } = useApiError();

const url = ref('');
const label = ref('');
const selectedEvents = ref<string[]>([]);
const customHooks = ref<string[]>([]);
const workspaceFilter = ref<string>('');
const saving = ref(false);
const formError = ref<string | null>(null);
const revealedSecret = ref<string | null>(null);

const eventOptions = computed(() => {
    if (props.admin) {
        return ADMIN_WEBHOOK_EVENT_TYPES.map((value) => ({
            value,
            description: ADMIN_WEBHOOK_EVENT_DESCRIPTIONS[value],
        }));
    }

    return WEBHOOK_EVENT_TYPES.map((value) => ({
        value,
        description: WEBHOOK_EVENT_DESCRIPTIONS[value],
    }));
});

const workspaceOptions = computed(() => [
    { label: 'All workspaces', value: '' },
    ...(props.workspaces ?? []).map((workspace) => ({
        label: workspace.name,
        value: workspace.id,
    })),
]);

const modalTitle = computed(() =>
    props.webhook
        ? props.admin
            ? 'Edit Admin Webhook'
            : 'Edit Webhook'
        : props.admin
          ? 'Create Admin Webhook'
          : 'Create Webhook'
);

const urlValidationMessage = computed(() => {
    const trimmed = url.value.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return 'Only HTTP and HTTPS URLs are supported.';
        }
        return null;
    } catch {
        return 'Enter a valid URL.';
    }
});

function resetFromProps() {
    url.value = props.webhook?.url ?? '';
    label.value = props.webhook?.label ?? '';
    selectedEvents.value = [...(props.webhook?.events ?? [])];
    customHooks.value =
        props.admin && props.webhook
            ? [...props.webhook.custom_hooks]
            : props.admin
              ? []
              : [];
    workspaceFilter.value = props.webhook?.workspace_id ?? '';
    formError.value = null;
    revealedSecret.value = null;
}

function closeModal() {
    isOpen.value = false;
}

function toggleEvent(eventType: string) {
    if (selectedEvents.value.includes(eventType)) {
        selectedEvents.value = selectedEvents.value.filter(
            (value) => value !== eventType
        );
        return;
    }

    selectedEvents.value = [...selectedEvents.value, eventType];
}

function selectAllEvents() {
    selectedEvents.value = eventOptions.value.map((item) => item.value);
}

function addCustomHook() {
    customHooks.value = [...customHooks.value, ''];
}

function updateCustomHook(index: number, value: string | number) {
    customHooks.value = customHooks.value.map((entry, currentIndex) =>
        currentIndex === index ? String(value) : entry
    );
}

function removeCustomHook(index: number) {
    customHooks.value = customHooks.value.filter(
        (_entry, currentIndex) => currentIndex !== index
    );
}

async function copySecret() {
    if (!revealedSecret.value || !import.meta.client) {
        return;
    }

    await navigator.clipboard.writeText(revealedSecret.value);
    toast.add({
        title: 'Signing secret copied',
        color: 'success',
    });
}

function validateForm(): string | null {
    if (!url.value.trim()) {
        return 'Webhook URL is required.';
    }
    if (urlValidationMessage.value) {
        return urlValidationMessage.value;
    }

    const normalizedCustomHooks = customHooks.value
        .map((value) => value.trim())
        .filter(Boolean);

    if (selectedEvents.value.length === 0 && normalizedCustomHooks.length === 0) {
        return 'Select at least one event or add a custom hook.';
    }

    const invalidCustomHook = normalizedCustomHooks.find(
        (value) =>
            !value.includes(':action:') && !value.includes(':filter:')
    );
    if (invalidCustomHook) {
        return 'Custom hook names must include :action: or :filter:.';
    }

    return null;
}

async function submit() {
    formError.value = validateForm();
    if (formError.value) {
        return;
    }

    saving.value = true;

    const basePath = props.admin ? '/api/admin/webhooks' : '/api/webhooks';
    const body: Record<string, unknown> = {
        url: url.value.trim(),
        label: label.value.trim(),
        events: selectedEvents.value,
    };

    if (props.admin) {
        body.custom_hooks = customHooks.value
            .map((value) => value.trim())
            .filter(Boolean);
        body.workspace_id = workspaceFilter.value || null;
    }

    try {
        if (props.webhook) {
            const response = await $fetch<{ webhook: ManagedWebhook }>(
                `${basePath}/${props.webhook.id}`,
                {
                    method: 'PATCH',
                    body,
                    credentials: 'include',
                }
            );
            emit('saved', response.webhook);
            isOpen.value = false;
            return;
        }

        const response = await $fetch<{
            webhook: ManagedWebhook;
            signing_secret: string;
        }>(basePath, {
            method: 'POST',
            body,
            credentials: 'include',
        });

        revealedSecret.value = response.signing_secret;
        emit('saved', response.webhook);
        toast.add({
            title: props.admin ? 'Admin webhook created' : 'Webhook created',
            color: 'success',
        });
    } catch (error: unknown) {
        formError.value = getMessage(error, 'Unable to save webhook');
    } finally {
        saving.value = false;
    }
}

watch(
    [isOpen, () => props.webhook?.id, () => props.admin],
    ([open]) => {
        if (open) {
            resetFromProps();
        }
    },
    { immediate: true }
);
</script>
