<template>
  <div class="space-y-3" aria-label="New external agent session">
    <div
      v-if="!availableOptions.length"
      class="text-sm text-[var(--md-on-surface-variant)]"
    >
      No external agent provider is ready on this host.
    </div>

    <template v-else>
      <ExternalAgentComposer
        v-model="instruction"
        :loading="launching"
        placeholder="Describe the change, investigation, or review…"
        @send="launch"
      >
        <template #leading>
          <span class="truncate text-xs text-[var(--md-on-surface-variant)]">
            {{ selectedOption?.runner.display_name ?? "Choose an agent" }}
            <template v-if="cwd"> · {{ cwd }}</template>
          </span>
        </template>
        <template #settings>
          <div class="space-y-3">
            <h2 class="text-sm font-semibold">Agent settings</h2>
            <label class="block space-y-1">
              <span class="text-xs font-semibold">Provider</span>
              <USelectMenu
                v-model="runnerId"
                :items="runnerItems"
                value-key="value"
                label-key="label"
                class="w-full"
                aria-label="External agent provider"
              />
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block space-y-1">
                <span class="text-xs font-semibold">Mode</span>
                <USelectMenu
                  v-model="mode"
                  :items="modeItems"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  aria-label="External agent mode"
                />
              </label>
              <label class="block space-y-1">
                <span class="text-xs font-semibold">Isolation</span>
                <USelectMenu
                  v-model="isolation"
                  :items="isolationItems"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  aria-label="External agent isolation"
                />
              </label>
            </div>

            <label class="block space-y-1">
              <span class="text-xs font-semibold">Workspace root</span>
              <UInput
                v-if="selectedOption?.customCwd"
                v-model="cwd"
                class="w-full"
                placeholder="Host workspace path (optional)"
                aria-label="External agent workspace root"
              />
              <USelectMenu
                v-else-if="rootItems.length"
                v-model="cwd"
                :items="rootItems"
                value-key="value"
                label-key="label"
                class="w-full"
                aria-label="External agent workspace root"
              />
              <p v-else class="text-xs text-[var(--md-on-surface-variant)]">
                The host will use its configured default working directory.
              </p>
              <span
                class="block text-[11px] text-[var(--md-on-surface-variant)]"
              >
                The host validates and enforces this root.
              </span>
            </label>

            <label v-if="modelItems.length" class="block space-y-1">
              <span class="text-xs font-semibold">Model (optional)</span>
              <USelectMenu
                :model-value="selectedModelValue"
                :items="modelItems"
                value-key="value"
                label-key="label"
                class="w-full"
                aria-label="External agent model"
                @update:model-value="setModel"
              />
            </label>

            <UCheckbox
              v-if="dangerousSelection"
              v-model="confirmDangerous"
              color="error"
              label="I understand this grants dangerous full access"
              description="Only use this mode on a trusted host and workspace."
            />
          </div>
        </template>
      </ExternalAgentComposer>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="Could not launch agent"
        :description="error"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ExternalAgentComposer from "./ExternalAgentComposer.vue";
import type { ExternalAgentSession } from "~/core/external-agents/types";
import { buildExternalAgentRunnerOptions } from "~/core/external-agents/launcher";
import { presentExternalAgentError } from "~/core/external-agents/presentation";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const emit = defineEmits<{
  launched: [session: ExternalAgentSession];
}>();

/** ComboboxItem rejects empty string values (reserved for clearing). */
const HOST_DEFAULT_MODEL_VALUE = "host_default";

const runtime = useExternalAgentRuntime();
const runnerId = ref("");
const instruction = ref("");
const mode = ref("review");
const isolation = ref("host_readonly");
const cwd = ref("");
const model = ref<string | null>(null);
const confirmDangerous = ref(false);
const launching = ref(false);
const error = ref<string | null>(null);

const options = computed(() =>
  buildExternalAgentRunnerOptions(runtime.snapshot.value?.runners ?? []),
);
const availableOptions = computed(() =>
  options.value.filter((option) => option.available),
);
const selectedOption = computed(() =>
  options.value.find((option) => option.runner.id === runnerId.value),
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
  (selectedOption.value?.isolations ?? []).map((item) => ({
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
    .map((root) => ({
      value: root,
      label: root,
    })),
);
const modelItems = computed(() => {
  const raw = selectedOption.value?.runner.models ?? [];
  return [
    { value: HOST_DEFAULT_MODEL_VALUE, label: "Host default" },
    ...raw
      .map((candidate) => {
        const id = typeof candidate.id === "string" ? candidate.id : "";
        if (!id || id === HOST_DEFAULT_MODEL_VALUE) return null;
        const provider =
          typeof candidate.provider === "string" ? candidate.provider : "";
        const value = provider && !id.includes("/") ? `${provider}/${id}` : id;
        if (!value || value === HOST_DEFAULT_MODEL_VALUE) return null;
        return {
          value,
          label:
            typeof candidate.display_name === "string"
              ? candidate.display_name
              : value,
        };
      })
      .filter(
        (
          item,
        ): item is {
          value: string;
          label: string;
        } => Boolean(item),
      ),
  ];
});
const selectedModelValue = computed(
  () => model.value ?? HOST_DEFAULT_MODEL_VALUE,
);

function setModel(value: string) {
  model.value =
    !value || value === HOST_DEFAULT_MODEL_VALUE ? null : value;
}
const dangerousSelection = computed(() => {
  const option = selectedOption.value;
  return Boolean(
    option?.modes.find((item) => item.id === mode.value)?.dangerous ||
    option?.isolations.find((item) => item.id === isolation.value)?.dangerous,
  );
});

watch(
  availableOptions,
  (next) => {
    if (!next.some((option) => option.runner.id === runnerId.value)) {
      runnerId.value = next[0]?.runner.id ?? "";
    }
  },
  { immediate: true },
);

watch(
  selectedOption,
  (option) => {
    if (!option) return;
    mode.value = option.defaultMode;
    isolation.value = option.defaultIsolation;
    cwd.value = option.defaultCwd || option.roots[0] || "";
    model.value = null;
    confirmDangerous.value = false;
  },
  { immediate: true },
);

watch([mode, isolation], () => {
  if (!dangerousSelection.value) confirmDangerous.value = false;
});

async function launch() {
  const controller = runtime.controller;
  if (!controller) {
    error.value = "External Agents is not available.";
    return;
  }
  launching.value = true;
  error.value = null;
  try {
    const session = await controller.launch({
      runnerId: runnerId.value,
      instruction: instruction.value,
      cwd: cwd.value || undefined,
      mode: mode.value,
      isolation: isolation.value,
      model: model.value ?? undefined,
      confirmDangerous: confirmDangerous.value,
    });
    instruction.value = "";
    emit("launched", session);
  } catch (cause) {
    error.value = presentExternalAgentError(
      cause,
      "The agent could not be started.",
    ).message;
  } finally {
    launching.value = false;
  }
}
</script>
