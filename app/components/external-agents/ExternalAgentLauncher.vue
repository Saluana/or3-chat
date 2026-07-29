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
          <ExternalAgentSettingsPanel
            v-model:runner-id="runnerId"
            v-model:mode="mode"
            v-model:isolation="isolation"
            v-model:cwd="cwd"
            v-model:model="model"
            v-model:confirm-dangerous="confirmDangerous"
            :runners="runners"
          />
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
import ExternalAgentSettingsPanel from "./ExternalAgentSettingsPanel.vue";
import type { ExternalAgentSession } from "~/core/external-agents/types";
import {
  buildExternalAgentRunnerOptions,
  isValidExternalAgentPolicyCombination,
} from "~/core/external-agents/launcher";
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
const runners = computed(() => runtime.snapshot.value?.runners ?? []);
const availableOptions = computed(() =>
  options.value.filter((option) => option.available),
);
const selectedOption = computed(() =>
  options.value.find((option) => option.runner.id === runnerId.value),
);

const isolationItems = computed(() =>
  (selectedOption.value?.isolations ?? [])
    .filter((item) =>
      isValidExternalAgentPolicyCombination(mode.value, item.id),
    )
    .map((item) => ({
      value: item.id,
      label: item.dangerous ? `${item.label} ⚠` : item.label,
    })),
);
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

watch(mode, () => {
  const compatible = isolationItems.value;
  if (!compatible.some((item) => item.value === isolation.value)) {
    isolation.value = compatible[0]?.value ?? "";
  }
});

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
