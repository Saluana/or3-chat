<template>
  <div class="dashboard-page-frame workspace-profile-settings">
    <p class="dashboard-list-footnote">
      Arrange existing OR3 surfaces without changing your theme, plugins, or
      workspace data.
    </p>

    <section class="dashboard-list-group" aria-labelledby="profile-choice-heading">
      <h3 id="profile-choice-heading" class="dashboard-list-heading">Profile</h3>
      <div class="dashboard-list" role="group" aria-labelledby="profile-choice-heading">
        <DashboardListRow
          v-for="registration in profiles"
          :key="registration.profile.id"
          :label="registration.profile.label"
          :description="registration.profile.description || undefined"
          :value="sourceLabel(registration.source)"
          :selected="draftProfileId === registration.profile.id"
          :disabled="pending || saving"
          @click="draftProfileId = registration.profile.id"
        />
      </div>
    </section>

    <section class="dashboard-list-group" aria-labelledby="profile-effect-heading">
      <h3 id="profile-effect-heading" class="dashboard-list-heading">
        {{
          draftProfileId === selectedProfileId
            ? "Active in this workspace"
            : "Profile preview"
        }}
      </h3>
      <dl class="dashboard-list">
        <div
          v-for="row in summaryRows"
          :key="row.label"
          class="dashboard-list-row profile-effect-row"
        >
          <dt class="dashboard-list-label">{{ row.label }}</dt>
          <dd class="profile-effect-value">
            {{ row.value }}
            <span v-if="row.hidden" class="block">
              Hidden: {{ row.hidden }}
            </span>
          </dd>
        </div>
      </dl>
    </section>

    <div
      v-if="draftResolved.diagnostics.length"
      class="profile-diagnostics"
    >
      <p>Some settings are unavailable and will use the closest supported option.</p>
      <details><summary>Technical details</summary>
      <ul class="mt-1 list-disc space-y-1 pl-4">
        <li
          v-for="diagnostic in draftResolved.diagnostics"
          :key="`${diagnostic.code}:${diagnostic.path}:${diagnostic.id}`"
        >
          {{ diagnostic.message }}
        </li>
      </ul></details>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <UButton
        color="primary"
        :loading="saving"
        :disabled="!draftRegistration || draftProfileId === selectedProfileId"
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

    <div
      v-if="showResetConfirmation"
      class="dashboard-list"
      data-testid="profile-reset-confirmation"
    >
      <div class="dashboard-list-body">
        <strong>Reset this workspace layout?</strong>
        <p class="dashboard-list-description">
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
    </div>

    <div v-if="recommendedRegistration" class="dashboard-list">
      <DashboardListRow
        static
        label="Recommended by active theme"
        :description="`${recommendedRegistration.profile.label} is available, but themes never change your layout automatically.`"
      >
        <template #trailing>
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            @click="draftProfileId = recommendedRegistration.profile.id"
          >
            Review
          </UButton>
        </template>
      </DashboardListRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import { presentError } from '~~/shared/errors';
import { computed, ref, watch } from "vue";
import { useToast } from "#imports";
import type { WorkspaceProfileSource } from "~/core/workspace-profiles";
import {
  activeThemeProfileRecommendation,
  resolveWorkspaceProfile,
} from "~/core/workspace-profiles";
import { useWorkspaceProfiles } from "~/composables/workspace-profiles/useWorkspaceProfiles";
import { useOr3Config } from "~/composables/useOr3Config";
import DashboardListRow from "./DashboardListRow.vue";

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
      description: presentError(error, { fallbackMessage: "Please try again." }).message,
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
      description: presentError(error, { fallbackMessage: "Please try again." }).message,
      color: "error",
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.workspace-profile-settings {
  gap: 28px;
}
.profile-effect-row {
  align-items: flex-start;
  justify-content: space-between;
}
.profile-effect-row dt {
  flex-shrink: 0;
}
.profile-effect-value {
  margin: 0;
  min-width: 0;
  color: var(--md-on-surface-variant, var(--md-on-surface));
  font-size: 14px;
  line-height: 22px;
  text-align: right;
  overflow-wrap: anywhere;
}
.profile-diagnostics {
  padding: 12px 16px;
  font-size: 12px;
  border: var(--md-border-width) solid color-mix(in srgb, var(--md-warning) 50%, transparent);
  border-radius: var(--md-border-radius-large, var(--md-border-radius));
}
@media (max-width: 639px) {
  .profile-effect-row {
    flex-direction: column;
    gap: 2px;
  }
  .profile-effect-value {
    text-align: left;
  }
}
</style>
