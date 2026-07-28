<template>
  <div class="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <header>
      <h2 class="text-xl font-semibold">Workspace Profile</h2>
      <p class="mt-1 text-sm opacity-70">
        Arrange existing OR3 surfaces without changing your theme, plugins, or
        workspace data.
      </p>
    </header>

    <UCard>
      <div class="space-y-4">
        <UFormField label="Profile" name="workspace-profile">
          <USelect
            v-model="draftProfileId"
            :items="profileOptions"
            value-key="value"
            label-key="label"
            class="w-full"
            :disabled="pending"
          />
        </UFormField>

        <div v-if="draftRegistration" class="space-y-2 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <strong>{{ draftRegistration.profile.label }}</strong>
            <UBadge color="neutral" variant="soft">
              {{ sourceLabel(draftRegistration.source) }}
            </UBadge>
          </div>
          <p class="opacity-75">
            {{
              draftRegistration.profile.description ||
              "No description provided."
            }}
          </p>
        </div>

        <div
          class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
          aria-label="Resolved profile summary"
        >
          <div class="rounded border border-[var(--md-border-color)] p-2">
            <div class="opacity-60">Navigation</div>
            <strong>{{ draftSummary.navigation }}</strong>
          </div>
          <div class="rounded border border-[var(--md-border-color)] p-2">
            <div class="opacity-60">Dashboard</div>
            <strong>{{ draftSummary.dashboard }}</strong>
          </div>
          <div class="rounded border border-[var(--md-border-color)] p-2">
            <div class="opacity-60">Initial panes</div>
            <strong>{{ draftSummary.panes }}</strong>
          </div>
          <div class="rounded border border-[var(--md-border-color)] p-2">
            <div class="opacity-60">Pinned commands</div>
            <strong>{{ draftSummary.commands }}</strong>
          </div>
        </div>

        <div
          v-if="draftResolved.diagnostics.length"
          class="rounded border border-[var(--md-warning)]/50 p-3 text-xs"
        >
          <strong>Compatibility notes</strong>
          <ul class="mt-1 list-disc space-y-1 pl-4">
            <li
              v-for="diagnostic in draftResolved.diagnostics"
              :key="`${diagnostic.code}:${diagnostic.path}:${diagnostic.id}`"
            >
              {{ diagnostic.message }}
            </li>
          </ul>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            color="primary"
            :loading="saving"
            :disabled="
              !draftRegistration || draftProfileId === selectedProfileId
            "
            @click="save"
          >
            Apply
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="saving"
            @click="showResetConfirmation = true"
          >
            Reset to Standard OR3
          </UButton>
        </div>
      </div>
    </UCard>

    <UCard v-if="recommendedRegistration">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div class="flex-1">
          <strong>Recommended by active theme</strong>
          <p class="text-sm opacity-70">
            {{ recommendedRegistration.profile.label }} is available, but themes
            never change your layout automatically.
          </p>
        </div>
        <UButton
          color="neutral"
          variant="soft"
          @click="draftProfileId = recommendedRegistration.profile.id"
        >
          Review recommendation
        </UButton>
      </div>
    </UCard>

    <UCard
      v-if="showResetConfirmation"
      data-testid="profile-reset-confirmation"
    >
      <div class="space-y-3">
        <strong>Reset this workspace layout?</strong>
        <p class="text-sm opacity-70">
          This selects Standard OR3 and resets the open layout. Chats,
          documents, projects, plugins, and theme settings are preserved.
        </p>
        <div class="flex gap-2">
          <UButton color="warning" :loading="saving" @click="reset">
            Confirm reset
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            @click="showResetConfirmation = false"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToast } from "#imports";
import type { WorkspaceProfileSource } from "~/core/workspace-profiles";
import {
  activeThemeProfileRecommendation,
  resolveWorkspaceProfile,
} from "~/core/workspace-profiles";
import { useWorkspaceProfiles } from "~/composables/workspace-profiles/useWorkspaceProfiles";
import { useOr3Config } from "~/composables/useOr3Config";

const toast = useToast();
const or3Config = useOr3Config();
const {
  profiles,
  selectedProfileId,
  resolvedProfile,
  pending,
  inventory,
  applyProfile,
  resetToStandard,
} = useWorkspaceProfiles();
const draftProfileId = ref(selectedProfileId.value);
const saving = ref(false);
const showResetConfirmation = ref(false);

watch(selectedProfileId, (profileId) => {
  if (!saving.value) draftProfileId.value = profileId;
});

const profileOptions = computed(() =>
  profiles.value.map((registration) => ({
    label: registration.profile.label,
    value: registration.profile.id,
  })),
);
const draftRegistration = computed(() =>
  profiles.value.find(
    (registration) => registration.profile.id === draftProfileId.value,
  ),
);
const draftResolved = computed(() => {
  const profile = draftRegistration.value?.profile;
  return profile
    ? resolveWorkspaceProfile(profile, inventory.value, {
        maxDesktopPanes: Math.max(1, Math.floor(or3Config.ui.maxPanes)),
        mobilePolicy: "single-pane",
      })
    : resolvedProfile.value;
});
const draftSummary = computed(() => ({
  navigation: draftResolved.value.navigation.items.length,
  dashboard: draftResolved.value.dashboard.items.length,
  panes: draftResolved.value.workspace.initialPanes.length,
  commands: draftResolved.value.commands.pinned.length,
}));
const recommendedRegistration = computed(() => {
  const recommendation = activeThemeProfileRecommendation.value;
  if (!recommendation) return undefined;
  return profiles.value.find(
    (registration) =>
      registration.profile.id === recommendation.profileId &&
      registration.source.kind === "theme" &&
      registration.source.id === recommendation.themeId,
  );
});

function sourceLabel(source: WorkspaceProfileSource): string {
  if (source.kind === "core") return "Built in";
  if (source.kind === "theme") return `Theme: ${source.id}`;
  return `Plugin: ${source.id}`;
}

async function save() {
  if (!draftRegistration.value || saving.value) return;
  saving.value = true;
  try {
    await applyProfile(draftRegistration.value.profile.id);
    toast.add({
      title: "Workspace profile applied",
      description: draftRegistration.value.profile.label,
      color: "success",
    });
  } catch (error) {
    toast.add({
      title: "Unable to apply profile",
      description: error instanceof Error ? error.message : "Please try again.",
      color: "error",
    });
  } finally {
    saving.value = false;
  }
}

async function reset() {
  if (saving.value) return;
  saving.value = true;
  try {
    await resetToStandard({ resetLayout: true });
    draftProfileId.value = "standard-or3";
    showResetConfirmation.value = false;
    toast.add({
      title: "Workspace reset to Standard OR3",
      description: "Your workspace data and plugins were preserved.",
      color: "success",
    });
  } catch (error) {
    toast.add({
      title: "Unable to reset profile",
      description: error instanceof Error ? error.message : "Please try again.",
      color: "error",
    });
  } finally {
    saving.value = false;
  }
}
</script>
