<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-sm font-semibold">Agent settings</h2>
      <p class="mt-0.5 text-xs text-[var(--md-on-surface-variant)]">
        {{
          runnerLocked
            ? "Applies to your next message."
            : "Configure this session."
        }}
      </p>
    </div>

    <label class="block space-y-1.5">
      <span
        class="flex items-center justify-between gap-2 text-xs font-semibold"
      >
        Agent
        <span
          v-if="runnerLocked"
          class="inline-flex items-center gap-1 font-normal text-[var(--md-on-surface-variant)]"
        >
          <UIcon :name="iconLock" class="size-3" />
          Fixed for this session
        </span>
      </span>
      <USelectMenu
        :model-value="runnerId"
        :items="runnerItems"
        value-key="value"
        label-key="label"
        class="w-full"
        aria-label="External agent provider"
        :disabled="runnerLocked"
        @update:model-value="$emit('update:runnerId', String($event ?? ''))"
      />
    </label>

    <div
      v-if="selectedOption?.showMode || selectedOption?.showIsolation"
      class="grid gap-3 sm:grid-cols-2"
    >
      <label v-if="selectedOption?.showMode" class="block space-y-1.5">
        <span class="text-xs font-semibold">Mode</span>
        <USelectMenu
          :model-value="mode"
          :items="modeItems"
          value-key="value"
          label-key="label"
          class="w-full"
          aria-label="External agent mode"
          @update:model-value="$emit('update:mode', String($event ?? ''))"
        />
      </label>
      <label v-if="selectedOption?.showIsolation" class="block space-y-1.5">
        <span class="text-xs font-semibold">Isolation</span>
        <USelectMenu
          :model-value="isolation"
          :items="isolationItems"
          value-key="value"
          label-key="label"
          class="w-full"
          aria-label="External agent isolation"
          @update:model-value="$emit('update:isolation', String($event ?? ''))"
        />
      </label>
    </div>

    <label v-if="selectedOption?.showWorkspace" class="block space-y-1.5">
      <span class="text-xs font-semibold">Workspace root</span>
      <UInput
        v-if="selectedOption?.customCwd"
        :model-value="cwd"
        class="w-full"
        placeholder="Host workspace path (optional)"
        aria-label="External agent workspace root"
        @update:model-value="$emit('update:cwd', String($event ?? ''))"
      />
      <USelectMenu
        v-else-if="rootItems.length"
        :model-value="cwd"
        :items="rootItems"
        value-key="value"
        label-key="label"
        class="w-full"
        aria-label="External agent workspace root"
        @update:model-value="$emit('update:cwd', String($event ?? ''))"
      />
      <p v-else class="text-xs text-[var(--md-on-surface-variant)]">
        The host will use its configured default working directory.
      </p>
      <span class="block text-[11px] text-[var(--md-on-surface-variant)]">
        The host validates and enforces this root.
      </span>
    </label>

    <label v-if="modelItems.length" class="block space-y-1.5">
      <span class="text-xs font-semibold">Model</span>
      <USelectMenu
        :model-value="selectedModelValue"
        :items="modelItems"
        virtualize
        value-key="value"
        label-key="label"
        class="w-full"
        aria-label="External agent model"
        @update:model-value="setModel"
      />
      <span
        v-if="modelCatalogError"
        class="block text-[11px] text-[var(--md-on-surface-variant)]"
        role="status"
      >
        {{ modelCatalogError }}
      </span>
    </label>

    <label v-if="reasoningItems.length" class="block space-y-1.5">
      <span class="text-xs font-semibold">Reasoning</span>
      <USelectMenu
        :model-value="selectedReasoningValue"
        :items="reasoningItems"
        value-key="value"
        label-key="label"
        class="w-full"
        aria-label="External agent reasoning level"
        @update:model-value="setThinkingLevel"
      />
      <span class="block text-[11px] text-[var(--md-on-surface-variant)]">
        Higher levels spend more time reasoning before responding.
      </span>
    </label>

    <UCheckbox
      v-if="dangerousSelection"
      :model-value="confirmDangerous"
      color="error"
      label="I understand this grants dangerous full access"
      description="Only use this mode on a trusted host and workspace."
      @update:model-value="$emit('update:confirmDangerous', Boolean($event))"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import {
  buildExternalAgentRunnerOptions,
  isValidExternalAgentPolicyCombination,
  resolveEffectiveExternalAgentModel,
  resolveExternalAgentModelReasoning,
} from "~/core/external-agents/launcher";
import type { ExternalAgentRunner } from "~/core/external-agents/types";
import { useIcon } from "~/composables/useIcon";

const iconLock = useIcon("ui.lock");

const HOST_DEFAULT_MODEL_VALUE = "host_default";
const MODEL_DEFAULT_REASONING_VALUE = "model_default";

const props = withDefaults(
  defineProps<{
    runners: readonly ExternalAgentRunner[];
    runnerId: string;
    mode: string;
    isolation: string;
    cwd: string;
    model: string | null;
    thinkingLevel?: string | null;
    confirmDangerous: boolean;
    runnerLocked?: boolean;
  }>(),
  { runnerLocked: false, thinkingLevel: null },
);

const emit = defineEmits<{
  "update:runnerId": [value: string];
  "update:mode": [value: string];
  "update:isolation": [value: string];
  "update:cwd": [value: string];
  "update:model": [value: string | null];
  "update:thinkingLevel": [value: string | null];
  "update:confirmDangerous": [value: boolean];
}>();

const options = computed(() => buildExternalAgentRunnerOptions(props.runners));
const selectedOption = computed(() =>
  options.value.find((option) => option.runner.id === props.runnerId),
);
const runnerItems = computed(() =>
  options.value.map((option) => ({
    value: option.runner.id,
    label: option.available
      ? option.runner.display_name
      : `${option.runner.display_name} — ${option.unavailableReason}`,
    disabled: !option.available,
  })),
);
const modeItems = computed(() =>
  (selectedOption.value?.modes ?? []).map((item) => ({
    value: item.id,
    label: item.dangerous ? `${item.label} ⚠` : item.label,
  })),
);
const isolationItems = computed(() =>
  (selectedOption.value?.isolations ?? [])
    .filter((item) =>
      isValidExternalAgentPolicyCombination(props.mode, item.id),
    )
    .map((item) => ({
      value: item.id,
      label: item.dangerous ? `${item.label} ⚠` : item.label,
    })),
);
const rootItems = computed(() =>
  [
    ...(selectedOption.value?.defaultCwd
      ? [selectedOption.value.defaultCwd]
      : []),
    ...(selectedOption.value?.roots ?? []),
  ]
    .filter((root, index, all) => all.indexOf(root) === index)
    .map((root) => ({ value: root, label: root })),
);
const modelItems = computed(() => {
  const raw = selectedOption.value?.runner.models ?? [];
  const seen = new Set<string>();
  return [
    { value: HOST_DEFAULT_MODEL_VALUE, label: "Recommended (default)" },
    ...raw
      .map((candidate) => {
        const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
        if (!id || id === HOST_DEFAULT_MODEL_VALUE || seen.has(id)) return null;
        seen.add(id);
        const displayName =
          typeof candidate.display_name === "string" &&
          candidate.display_name.trim()
            ? candidate.display_name.trim()
            : id;
        const providerName =
          typeof candidate.provider_name === "string" &&
          candidate.provider_name.trim()
            ? candidate.provider_name.trim()
            : typeof candidate.provider === "string"
              ? candidate.provider.trim()
              : "";
        return {
          value: id,
          label: providerName
            ? `${displayName} · ${providerName}`
            : displayName,
        };
      })
      .filter((item): item is { value: string; label: string } =>
        Boolean(item),
      ),
  ];
});
const modelCatalogError = computed(() => {
  const value = selectedOption.value?.runner.runtime?.model_catalog_error;
  return typeof value === "string" && value.trim() ? value : "";
});
const selectedModelValue = computed(
  () => props.model ?? HOST_DEFAULT_MODEL_VALUE,
);
const selectedReasoning = computed(() =>
  resolveExternalAgentModelReasoning(selectedOption.value?.runner, props.model),
);
const reasoningItems = computed(() => {
  const reasoning = selectedReasoning.value;
  if (!reasoning?.values.length) return [];
  const defaultLabel = reasoning.defaultValue
    ? `Model default (${reasoningLevelLabel(reasoning.defaultValue)})`
    : "Model default";
  return [
    { value: MODEL_DEFAULT_REASONING_VALUE, label: defaultLabel },
    ...reasoning.values.map((value) => ({
      value,
      label: reasoningLevelLabel(value),
    })),
  ];
});
const selectedReasoningValue = computed(() =>
  props.thinkingLevel &&
  selectedReasoning.value?.values.includes(props.thinkingLevel)
    ? props.thinkingLevel
    : MODEL_DEFAULT_REASONING_VALUE,
);
const dangerousSelection = computed(() => {
  const option = selectedOption.value;
  return Boolean(
    option?.modes.find((item) => item.id === props.mode)?.dangerous ||
    option?.isolations.find((item) => item.id === props.isolation)?.dangerous,
  );
});

watch(
  [selectedReasoning, () => props.thinkingLevel],
  ([reasoning, thinkingLevel]) => {
    if (thinkingLevel && !reasoning?.values.includes(thinkingLevel)) {
      emit("update:thinkingLevel", null);
    }
  },
  { immediate: true },
);

function setModel(value: string) {
  emit(
    "update:model",
    !value || value === HOST_DEFAULT_MODEL_VALUE ? null : value,
  );
  emit("update:thinkingLevel", null);
}

function reasoningLevelLabel(value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized === "xhigh" || normalized === "extra-high") {
    return "Extra high";
  }
  if (normalized === "max" || normalized === "maximum") return "Maximum";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function setThinkingLevel(value: string) {
  const thinkingLevel =
    !value || value === MODEL_DEFAULT_REASONING_VALUE ? null : value;
  if (thinkingLevel && !props.model) {
    const effectiveModel = resolveEffectiveExternalAgentModel(
      selectedOption.value?.runner,
      null,
      thinkingLevel,
    );
    if (effectiveModel) emit("update:model", effectiveModel);
  }
  emit("update:thinkingLevel", thinkingLevel);
}
</script>
