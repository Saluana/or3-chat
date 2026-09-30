<template>
    <div class="space-y-6">
        <header class="space-y-2">
            <h2 class="font-heading text-lg text-[var(--md-on-surface)]">
                {{ step.title }}
            </h2>
            <p
                v-if="step.description"
                class="text-sm leading-relaxed whitespace-pre-line text-[var(--md-on-surface)]/60"
            >
                {{ step.description }}
            </p>
        </header>

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div class="space-y-5">
                <WizardFieldRenderer
                    v-for="field in visibleFields"
                    :key="String(field.key)"
                    :field="field"
                    :model-value="answers[field.key]"
                    :error="fieldErrors[field.key]"
                    @update:model-value="(value) => emit('update-field', field.key, value)"
                    @generate-secret="(key) => emit('generate-secret', key)"
                />
            </div>

            <div class="self-start space-y-3">
                <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--md-on-surface)]/50">
                    {{ selectedThemeLabel }}
                </div>
                <button
                    type="button"
                    class="group relative block w-full cursor-zoom-in overflow-hidden rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]"
                    :aria-label="`Expand ${selectedThemeLabel} preview`"
                    @click="openLightbox"
                >
                    <img
                        :src="previewImage"
                        :alt="selectedThemeLabel"
                        class="w-full transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                    <div class="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/20">
                        <div class="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100">
                            <svg class="h-4 w-4 text-gray-800" viewBox="0 0 16 16" fill="none">
                                <path d="M6 2H2v4M14 6V2h-4M6 14H2v-4M10 14h4v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                    </div>
                </button>
            </div>
        </div>

        <!-- Lightbox -->
        <UModal
            v-model:open="lightboxOpen"
            fullscreen
            :title="selectedThemeLabel + ' preview'"
            description="Preview this theme. Close the preview to return to setup."
            :content="lightboxDialogContent"
            :ui="{ overlay: 'z-[9998]!', content: 'z-[9999]! bg-black/80! rounded-none! border-0! ring-0! p-0! divide-y-0!' }"
        >
            <template #content>
                <div
                    class="flex h-full w-full items-center justify-center p-4"
                    @click.self="closeLightbox"
                >
                    <div class="relative max-h-full max-w-5xl w-full pt-12">
                        <h3
                            :id="lightboxTitleId"
                            class="sr-only"
                        >
                            {{ selectedThemeLabel }} preview
                        </h3>
                        <button
                            type="button"
                            class="absolute right-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg transition-transform hover:scale-110 focus:outline-none"
                            aria-label="Close preview"
                            @click="closeLightbox"
                        >
                            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none">
                                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                        <img
                            :src="previewImage"
                            :alt="selectedThemeLabel"
                            class="max-h-[calc(100dvh-8rem)] w-full rounded-[var(--md-border-radius-large)] object-contain shadow-2xl"
                        />
                        <p
                            :id="lightboxHintId"
                            class="mt-3 text-center text-xs text-white/60"
                        >
                            {{ selectedThemeLabel }} · Click outside or press Esc to close
                        </p>
                    </div>
                </div>
            </template>
        </UModal>
    </div>
</template>

<script setup lang="ts">
import type { WizardAnswers, WizardField, WizardStep } from '~~/shared/cloud/wizard/types';
import WizardFieldRenderer from './WizardFieldRenderer.vue';
import { useDialogFocus } from '~/composables/ui/useDialogFocus';

const props = defineProps<{
    step: WizardStep;
    answers: WizardAnswers;
    fieldErrors: Partial<Record<keyof WizardAnswers, string>>;
}>();

const emit = defineEmits<{
    (event: 'update-field', key: keyof WizardAnswers, value: unknown): void;
    (event: 'generate-secret', key: keyof WizardAnswers): void;
}>();

const lightboxOpen = ref(false);
const lightboxDialogContent = useDialogFocus(undefined, () => 'fullscreen');
const lightboxTitleId = 'wizard-theme-preview-title';
const lightboxHintId = 'wizard-theme-preview-hint';

function openLightbox(): void {
    lightboxOpen.value = true;
}

function closeLightbox(): void {
    lightboxOpen.value = false;
}

const visibleFields = computed<WizardField[]>(() =>
    props.step.fields.filter((field) =>
        typeof field.visibleWhen === 'function'
            ? field.visibleWhen(props.answers)
            : true
    )
);

const selectedThemeLabel = computed(() =>
    props.answers.or3DefaultTheme === 'blank' ? 'Blank Theme' : 'Retro Theme'
);

const previewImage = computed(() =>
    props.answers.or3DefaultTheme === 'blank'
        ? '/screenshots/blank-theme-preview.png'
        : '/screenshots/retro-theme-preview.png'
);
</script>
