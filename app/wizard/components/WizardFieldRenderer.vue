<template>
    <div class="space-y-2">
        <div class="flex items-center justify-between gap-3">
            <label
                :for="fieldId"
                class="text-sm font-medium text-[var(--md-on-surface)]"
            >
                {{ field.label }}
            </label>
            <UButton
                v-if="showSecretGenerateButton"
                label="Generate Secure Key"
                size="sm"
                variant="basic"
                :disabled="disabled"
                @click="emitGenerateSecret"
            />
        </div>

        <p
            v-if="field.help"
            :id="helpId"
            class="text-xs text-[var(--md-on-surface)]/50"
        >
            {{ field.help }}
        </p>

        <template v-if="field.type === 'boolean'">
            <div
                class="rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-3 py-2.5"
                :class="errorClass"
            >
                <UCheckbox
                    :id="fieldId"
                    :model-value="booleanValue"
                    :label="booleanLabel"
                    :disabled="disabled"
                    :aria-describedby="ariaDescribedBy"
                    @update:model-value="onCheckboxChange"
                />
            </div>
        </template>

        <template v-else-if="field.type === 'select'">
            <USelect
                :id="fieldId"
                :model-value="selectValue"
                :items="selectItems"
                :disabled="disabled"
                class="w-full"
                :aria-describedby="ariaDescribedBy"
                @update:model-value="onUSelectChange"
            />
        </template>

        <template v-else-if="field.type === 'multi-string'">
            <UInput
                :id="fieldId"
                :model-value="multiStringValue"
                :disabled="disabled"
                placeholder="value-a, value-b, value-c"
                class="w-full"
                :ui="{ base: errorClass }"
                :aria-describedby="ariaDescribedBy"
                @update:model-value="onMultiStringChange"
            />
        </template>

        <template v-else>
            <UInput
                :id="fieldId"
                :type="inputType"
                :model-value="textValue"
                :disabled="disabled"
                class="w-full"
                :ui="{ base: errorClass }"
                :aria-describedby="ariaDescribedBy"
                @update:model-value="onTextValueChange"
                @blur="onFieldBlur"
            />
        </template>

        <p
            v-if="error"
            :id="errorId"
            class="text-xs text-[var(--md-error)]"
        >
            {{ error }}
        </p>
        <p
            v-else-if="showEmptyFieldHint"
            :id="emptyStateId"
            class="text-xs text-[var(--md-on-surface)]/40"
        >
            This field is empty.
        </p>
    </div>
</template>

<script setup lang="ts">
import type { WizardAnswers, WizardField } from '~~/shared/cloud/wizard/types';

const props = withDefaults(
    defineProps<{
        field: WizardField;
        modelValue: unknown;
        error?: string;
        disabled?: boolean;
    }>(),
    {
        error: '',
        disabled: false,
    }
);

const emit = defineEmits<{
    (event: 'update:modelValue', value: unknown): void;
    (event: 'generate-secret', key: keyof WizardAnswers): void;
}>();

const touched = ref(false);

const errorClass = computed(() =>
    props.error
        ? 'border-[var(--md-error)]! ring-1! ring-[var(--md-error)]!'
        : ''
);

const fieldId = computed(() =>
    `wizard-field-${String(props.field.key).replace(/[^a-zA-Z0-9_-]/g, '-')}`
);

const helpId = computed(() =>
    props.field.help ? `${fieldId.value}-help` : ''
);

const errorId = computed(() =>
    props.error ? `${fieldId.value}-error` : ''
);

const showSecretGenerateButton = computed(
    () => Boolean(props.field.secret && props.field.type === 'password')
);

const inputType = computed(() => {
    if (props.field.type === 'password') return 'password';
    if (props.field.type === 'number') return 'number';
    return 'text';
});

const textValue = computed(() => {
    if (props.modelValue === undefined || props.modelValue === null) return '';
    return String(props.modelValue);
});

const multiStringValue = computed(() => {
    if (Array.isArray(props.modelValue)) {
        return props.modelValue.join(', ');
    }
    if (props.modelValue === undefined || props.modelValue === null) return '';
    return String(props.modelValue);
});

const selectValue = computed(() => {
    if (props.modelValue === undefined || props.modelValue === null) return '';
    return String(props.modelValue);
});

const selectItems = computed(() =>
    (props.field.options ?? []).map((opt) => ({
        label: opt.label,
        value: String(opt.value),
    }))
);

const booleanValue = computed(() => Boolean(props.modelValue));

const booleanLabel = computed(() => (booleanValue.value ? 'Enabled' : 'Disabled'));

const showEmptyFieldHint = computed(
    () =>
        touched.value &&
        !textValue.value &&
        props.field.type !== 'boolean' &&
        props.field.type !== 'select'
);

const emptyStateId = computed(() =>
    showEmptyFieldHint.value ? `${fieldId.value}-empty` : ''
);

const ariaDescribedBy = computed(() => {
    const ids = [helpId.value, errorId.value, emptyStateId.value].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
});

function onFieldBlur(): void {
    touched.value = true;
}

function onTextValueChange(nextValue: string | number): void {
    touched.value = true;
    if (props.field.type === 'number') {
        const asNumber = Number(nextValue);
        emit('update:modelValue', Number.isFinite(asNumber) ? asNumber : 0);
        return;
    }
    emit('update:modelValue', String(nextValue));
}

function onCheckboxChange(value: boolean | 'indeterminate'): void {
    emit('update:modelValue', value === true);
}

function onUSelectChange(value: string): void {
    const option = props.field.options?.find(
        (candidate) => String(candidate.value) === value
    );
    emit('update:modelValue', option ? option.value : value);
}

function onMultiStringChange(nextValue: string | number): void {
    const normalized = String(nextValue)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    emit('update:modelValue', normalized);
}

function emitGenerateSecret(): void {
    emit('generate-secret', props.field.key);
}
</script>
