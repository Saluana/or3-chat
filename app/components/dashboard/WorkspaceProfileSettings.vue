<template>
  <div class="dashboard-page-frame">
    <header class="dashboard-page-intro">
      <p class="dashboard-page-description">
        Arrange existing OR3 surfaces without changing your theme, plugins, or
        workspace data.
      </p>
    </header>

    <UCard class="section-card">
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

        <section aria-labelledby="profile-effect-heading" class="space-y-2">
          <h3 id="profile-effect-heading" class="text-xs font-semibold">
            {{
              draftProfileId === selectedProfileId
                ? "Active in this workspace"
                : "Profile preview"
            }}
          </h3>
          <dl class="profile-effect-list">
            <div
              v-for="row in summaryRows"
              :key="row.label"
              class="profile-effect-row"
            >
              <dt>{{ row.label }}</dt>
              <dd>
                {{ row.value }}
                <span v-if="row.hidden" class="block opacity-70">
                  Hidden: {{ row.hidden }}
                </span>
              </dd>
            </div>
          </dl>
        </section>

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

        <div class="flex flex-wrap items-center justify-between gap-3">
          <UButton
            color="primary"
            :loading="saving"
            :disabled="
              !draftRegistration || draftProfileId === selectedProfileId
            "
            @click="save"
          >
            Apply profile
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="saving"
            @click="showResetConfirmation = true"
          >
            Reset to Standard OR3
          </UButton>
        </div>
      </div>
    </UCard>

    <UCard v-if="recommendedRegistration" class="section-card">
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
      class="section-card"
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
const summaryRows = computed(() => {
  const resolved = draftResolved.value;
  // Ids the workspace does not offer are skipped (the notes below name them).
  const names = (
    requested: readonly string[],
    items: readonly { id: string; label?: string }[],
    noun: string,
  ) => {
    const byId = new Map(items.map((item) => [item.id, item.label]));
    const ids = requested.filter((id) => byId.has(id));
    const label = (id: string) =>
      byId.get(id) ||
      id.replace(/^[a-z0-9]+:/, "").replace(/[-_.]+/g, " ").replace(/^./, (c) => c.toUpperCase());
    if (ids.length === items.length && ids.length > 5) {
      return `All ${ids.length} ${noun}`;
    }
    const shown = ids.slice(0, 5).map(label).join(", ");
    return ids.length > 5 ? `${shown} +${ids.length - 5} more` : shown;
  };
  const { navigation, dashboard, panes, commands } = inventory.value;
  return [
    {
      label: "Sidebar pages",
      value: names(resolved.navigation.items, navigation, "pages") || "None",
      hidden: names(resolved.navigation.hidden, navigation, "pages"),
    },
    {
      label: "Dashboard tools",
      value: names(resolved.dashboard.items, dashboard, "tools") || "None",
      hidden: names(resolved.dashboard.hidden, dashboard, "tools"),
    },
    {
      label: "Initial panes",
      value: `${
        names(
          resolved.workspace.initialPanes.map((pane) => pane.id),
          panes,
          "panes",
        ) || "Chat"
      } · up to ${resolved.workspace.desktopPaneLimit} side by side`,
    },
    {
      label: "Pinned commands",
      value: names(resolved.commands.pinned, commands, "commands") || "None",
      hidden: names(resolved.commands.hidden, commands, "commands"),
    },
  ];
});
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

<style scoped>
.profile-effect-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem;
  font-size: 0.8rem;
  background: var(--md-surface-container-low, var(--md-surface-variant));
  border-radius: var(--md-border-radius-small, var(--md-border-radius));
}
.profile-effect-row {
  display: grid;
  gap: 0.15rem 1rem;
}
.profile-effect-row dt {
  color: var(--md-on-surface-variant, var(--md-on-surface));
  font-weight: 600;
}
.profile-effect-row dd {
  margin: 0;
  overflow-wrap: anywhere;
}
@media (min-width: 640px) {
  .profile-effect-row {
    grid-template-columns: 9rem minmax(0, 1fr);
  }
}
</style>
