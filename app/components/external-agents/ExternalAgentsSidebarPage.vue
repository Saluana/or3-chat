<template>
  <section
    class="external-agents-sidebar flex h-full min-h-0 flex-col"
    :class="{
      'external-agents-sidebar--textured': usesTexturedSidebarTreatment,
      'external-agents-sidebar--retro': activeTheme === 'retro',
      'external-agents-sidebar--cyberpunk': activeTheme === 'cyberpunk',
    }"
    aria-label="Agents"
  >
    <header class="agent-sidebar-header shrink-0 space-y-2 px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <UButton
          class="agent-sidebar-header-button whitespace-nowrap"
          variant="ghost"
          color="neutral"
          size="sm"
          :icon="iconChevronLeft"
          @click="setActivePage('sidebar-home')"
        >
          Home
        </UButton>
        <div
          class="agent-sidebar-header-actions flex shrink-0 items-center gap-1"
        >
          <UTooltip text="Connection settings" :delay-duration="0">
            <UButton
              class="agent-sidebar-header-button"
              variant="ghost"
              color="neutral"
              size="sm"
              square
              :icon="iconSettings"
              aria-label="Connection settings"
              @click="showConnections = true"
            />
          </UTooltip>
          <UTooltip text="New agent" :delay-duration="0">
            <UButton
              class="agent-new-button whitespace-nowrap"
              size="sm"
              variant="soft"
              :icon="iconBot"
              aria-label="New agent"
              @click="openLauncher"
            >
              <span class="agent-new-button-label whitespace-nowrap">
                New agent
              </span>
            </UButton>
          </UTooltip>
        </div>
      </div>

      <UInput
        v-model="query"
        :icon="iconSearch"
        placeholder="Search agent sessions"
        aria-label="Search agent sessions"
        class="agent-sidebar-search w-full"
      />
    </header>

    <div
      v-if="connectionNotice"
      class="agent-connection-notice mx-3 mb-2 flex items-center gap-2 rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] px-3 py-2"
      role="status"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :class="
          connected
            ? 'bg-[var(--md-extended-color-success-color)]'
            : 'bg-[var(--md-error)]'
        "
      />
      <p class="agent-connection-notice-copy min-w-0 flex-1 truncate text-xs">
        {{ connectionNotice }}
      </p>
      <UButton
        v-if="!connected || !hasAvailableRunner"
        class="agent-connection-fix"
        size="xs"
        variant="ghost"
        @click="showConnections = true"
      >
        Fix
      </UButton>
    </div>

    <div class="agent-sidebar-history min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      <SidebarEmptyState
        v-if="!history.length"
        title="No agent sessions yet"
        description="Start with an instruction. Tools, approvals, and results will appear in the conversation."
        :icon="iconBot"
      >
        <template #actions>
          <UButton size="sm" @click="openLauncher">New agent</UButton>
          <UButton
            v-if="!snapshot?.hosts.length"
            size="sm"
            variant="soft"
            @click="showConnections = true"
          >
            Connect host
          </UButton>
        </template>
      </SidebarEmptyState>

      <div
        v-else-if="!filteredHistory.length"
        class="grid min-h-48 place-items-center px-4 text-center"
      >
        <div>
          <UIcon
            :name="iconSearchEmpty"
            class="mx-auto mb-2 size-6 text-[var(--md-on-surface-variant)]"
          />
          <p class="text-sm font-medium">No matching sessions</p>
          <p class="mt-1 text-xs text-[var(--md-on-surface-variant)]">
            Try a different title, provider, or result.
          </p>
        </div>
      </div>

      <section
        v-for="group in groupedHistory"
        v-else
        :key="group.key"
        class="mb-2"
      >
        <SidebarGroupHeader
          :label="group.label"
          :collapsed="collapsed.has(group.key)"
          @toggle="toggleGroup(group.key)"
        />
        <div v-if="!collapsed.has(group.key)" class="space-y-0.5">
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="agent-session-row group w-full rounded-[var(--md-border-radius)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--md-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]"
            :class="
              activeRecordId === item.recordId
                ? 'bg-[var(--md-surface-active)]'
                : ''
            "
            :aria-current="
              activeRecordId === item.recordId ? 'page' : undefined
            "
            @click="openHistory(item)"
          >
            <div class="flex items-start gap-2">
              <span class="mt-1 grid size-4 shrink-0 place-items-center">
                <UIcon
                  v-if="item.status === 'running' || item.status === 'queued'"
                  :name="iconLoading"
                  class="size-3.5 animate-spin"
                />
                <UIcon
                  v-else-if="item.pendingApprovalCount"
                  :name="iconShieldAlert"
                  class="size-3.5 text-[var(--md-extended-color-warning-color)]"
                />
                <UIcon
                  v-else-if="item.status === 'failed'"
                  :name="iconWarning"
                  class="size-3.5 text-[var(--md-error)]"
                />
                <UIcon
                  v-else
                  :name="iconBot"
                  class="size-3.5 text-[var(--md-on-surface-variant)]"
                />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {{ item.title }}
                  </span>
                  <UBadge
                    v-if="item.pendingApprovalCount"
                    color="warning"
                    variant="soft"
                    size="xs"
                    :aria-label="`${item.pendingApprovalCount} pending approvals`"
                  >
                    {{ item.pendingApprovalCount }}
                  </UBadge>
                  <time
                    class="agent-session-time shrink-0 text-[10px] text-[var(--md-on-surface-variant)]"
                  >
                    {{ item.timeLabel }}
                  </time>
                </div>
                <p
                  v-if="item.preview"
                  class="agent-session-preview mt-0.5 line-clamp-2 text-xs text-[var(--md-on-surface-variant)]"
                >
                  {{ item.preview }}
                </p>
                <p
                  class="agent-session-meta mt-0.5 truncate text-[10px] text-[var(--md-on-surface-variant)]"
                >
                  {{ item.runnerLabel }} · {{ statusText(item.status) }}
                </p>
              </div>
            </div>
          </button>
        </div>
      </section>
    </div>

    <footer
      class="agent-sidebar-footer shrink-0 border-t border-[var(--md-outline-variant)] px-2 py-1.5"
    >
      <UPopover v-model:open="hostSwitcherOpen">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-[var(--md-border-radius)] px-2 py-1.5 text-left hover:bg-[var(--md-surface-container)] focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]"
          aria-label="Switch agent host"
    >
      <span
            class="size-2 shrink-0 rounded-full"
        :class="
          connected
            ? 'bg-[var(--md-extended-color-success-color)]'
            : 'bg-[var(--md-on-surface-variant)]'
        "
      />
      <span
        class="min-w-0 flex-1 truncate text-xs text-[var(--md-on-surface-variant)]"
      >
        {{ activeHostName }}
      </span>
      <span v-if="runningCount" class="text-xs"
        >{{ runningCount }} running</span
      >
      <span v-if="approvalCount" class="text-xs"
        >{{ approvalCount }} waiting</span
      >
          <UIcon :name="iconChevronRight" class="size-3 rotate-[-90deg]" />
        </button>

        <template #content>
          <div class="w-72 p-2" data-testid="agent-host-switcher">
            <p
              class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--md-on-surface-variant)]"
            >
              Agent hosts
            </p>
            <button
              v-for="host in hostItems"
              :key="host.value"
              type="button"
              class="flex w-full items-center gap-2 rounded-[var(--md-border-radius)] px-2 py-2 text-left hover:bg-[var(--md-surface-container)] disabled:opacity-60"
              :disabled="quickHostPending"
              @click="quickSwitchHost(host.value)"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="
                  host.value === snapshot?.activeHostId && connected
                    ? 'bg-[var(--md-extended-color-success-color)]'
                    : 'bg-[var(--md-on-surface-variant)] opacity-45'
                "
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{
                  host.label
                }}</span>
                <span
                  class="block truncate text-[11px] text-[var(--md-on-surface-variant)]"
                  >{{ host.description }}</span
                >
              </span>
              <UIcon
                v-if="host.value === snapshot?.activeHostId"
                :name="iconCheck"
                class="size-4 shrink-0"
              />
            </button>

            <form
              v-if="pinCredentialStatus.locked"
              class="mt-2 border-t border-[var(--md-outline-variant)] px-2 pt-2"
              @submit.prevent="quickUnlockHosts"
            >
              <label class="text-xs font-medium" for="quick-host-pin">
                Unlock saved hosts
              </label>
              <div class="mt-1 flex gap-1.5">
                <input
                  id="quick-host-pin"
                  v-model="quickUnlockPin"
                  type="password"
                  inputmode="numeric"
                  autocomplete="current-password"
                  maxlength="128"
                  class="min-w-0 flex-1 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-transparent px-2 py-1.5 text-sm"
                  placeholder="PIN"
                />
                <UButton type="submit" size="xs" :loading="quickHostPending">
                  Unlock
                </UButton>
              </div>
            </form>
            <p
              v-if="quickSwitchError"
              class="px-2 pt-2 text-xs text-[var(--md-error)]"
              role="status"
            >
              {{ quickSwitchError }}
            </p>
            <button
              type="button"
              class="mt-2 w-full border-t border-[var(--md-outline-variant)] px-2 pt-2 text-left text-xs font-medium text-[var(--md-primary)]"
              @click="openConnections"
            >
              Manage connections
            </button>
          </div>
        </template>
      </UPopover>
    </footer>

    <UModal
      v-model:open="showConnections"
      title="Agent connections"
      description="Manage trusted agent services and credentials."
      :ui="{
        overlay: 'bg-black/35 backdrop-blur-[3px]',
        content:
          'sm:max-w-[900px] overflow-hidden border-[var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] shadow-2xl',
        header: 'border-b border-[var(--md-outline-variant)] px-5 py-4 sm:px-6',
        body: 'p-0 sm:p-0',
        close: 'top-4 end-4',
      }"
    >
      <template #title>
        <span class="flex min-w-0 items-center gap-2">
          <span
            class="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
          >
            <UIcon :name="iconNetwork" class="size-4" />
          </span>
          <span class="truncate text-base font-semibold sm:text-lg">
            Agent connections
          </span>
        </span>
      </template>
      <template #description>
        <span
          class="hidden pl-10 text-xs text-[var(--md-on-surface-variant)] sm:block"
        >
          Connect OR3 to the trusted machines that run your agents.
        </span>
      </template>

      <template #body>
        <div
          class="grid max-h-[min(76vh,700px)] min-h-0 md:grid-cols-[240px_minmax(0,1fr)]"
          data-testid="agent-connections-modal"
        >
          <aside
            class="border-b border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-4 md:border-b-0 md:border-r md:p-5"
            aria-label="Saved hosts"
          >
            <div class="mb-3 flex items-center justify-between">
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wider">
                  Trusted hosts
                </h3>
                <p
                  class="mt-0.5 text-[11px] text-[var(--md-on-surface-variant)]"
                >
                  {{ hostItems.length }}
                  {{ hostItems.length === 1 ? "connection" : "connections" }}
                </p>
              </div>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                square
                :icon="iconPlus"
                aria-label="Add a trusted host"
                @click="focusAddHost"
              />
            </div>

            <div v-if="hostItems.length" class="space-y-1.5">
              <button
                v-for="host in hostItems"
                :key="host.value"
                type="button"
                class="group w-full rounded-[var(--md-border-radius)] border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]"
                :class="
                  host.value === snapshot?.activeHostId
                    ? 'border-[var(--md-primary)] bg-[var(--md-surface-container-lowest)] shadow-sm'
                    : 'border-transparent hover:border-[var(--md-outline-variant)] hover:bg-[var(--md-surface-container-lowest)]'
                "
                :aria-pressed="host.value === snapshot?.activeHostId"
                @click="switchHost(host.value)"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="size-2 shrink-0 rounded-full"
                    :class="
                      host.value === snapshot?.activeHostId && connected
                        ? 'bg-[var(--md-extended-color-success-color)]'
                        : 'bg-[var(--md-on-surface-variant)] opacity-45'
                    "
                  />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {{ host.label }}
                  </span>
                  <span
                    v-if="host.value === snapshot?.activeHostId"
                    class="rounded-full bg-[var(--md-primary-container)] px-2 py-0.5 text-[10px] font-semibold text-[var(--md-on-primary-container)]"
                  >
                    Active
                  </span>
                </div>
                <p
                  class="mt-1 truncate pl-4 text-[11px] text-[var(--md-on-surface-variant)]"
                >
                  {{ host.description }}
                </p>
              </button>
            </div>

            <div
              v-else
              class="rounded-[var(--md-border-radius)] border border-dashed border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4 text-center"
            >
              <span
                class="mx-auto grid size-9 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
              >
                <UIcon :name="iconServer" class="size-4" />
              </span>
              <p class="mt-2 text-sm font-medium">No hosts yet</p>
              <p
                class="mt-1 text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
              >
                Add the machine where your agent runtime is available.
              </p>
            </div>

            <div
              class="mt-4 hidden rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-3 md:block"
            >
              <div class="flex items-start gap-2">
                <UIcon
                  :name="iconShieldCheck"
                  class="mt-0.5 size-4 shrink-0 text-[var(--md-primary)]"
                />
                <p
                  class="text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                >
                  Tokens stay on this device and are never included in chats or
                  Activity.
                </p>
              </div>
            </div>
          </aside>

          <div class="min-h-0 overflow-y-auto" :aria-busy="hostActionPending">
            <section
              v-if="activeHost"
              class="border-b border-[var(--md-outline-variant)] p-4 sm:p-5"
              aria-labelledby="current-connection-title"
            >
              <div class="flex flex-wrap items-start gap-3">
                <span
                  class="grid size-10 shrink-0 place-items-center rounded-[var(--md-border-radius)]"
                  :class="
                    connected
                      ? 'bg-[color-mix(in_srgb,var(--md-extended-color-success-color)_14%,transparent)] text-[var(--md-extended-color-success-color)]'
                      : 'bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)]'
                  "
                >
                  <UIcon
                    :name="connected ? iconCheck : iconServerOff"
                    class="size-5"
                  />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3
                      id="current-connection-title"
                      class="truncate text-sm font-semibold"
                    >
                      {{ activeHost.name }}
                    </h3>
                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      :class="connectionStatusClasses"
                    >
                      {{ connectionStatusLabel }}
                    </span>
                  </div>
                  <p
                    class="mt-0.5 truncate text-xs text-[var(--md-on-surface-variant)]"
                  >
                    {{ activeHost.baseUrl }}
                  </p>
                  <p
                    class="mt-1 text-[11px] text-[var(--md-on-surface-variant)]"
                  >
                    {{ activeRuntimeLabel }} · {{ activeDriverLabel }}
                  </p>
                  <p
                    v-if="
                      snapshot?.connectionError && !pinCredentialStatus.locked
                    "
                    class="mt-2 text-xs text-[var(--md-error)]"
                    role="status"
                  >
                    {{ snapshot.connectionError }}
                  </p>
                  <p
                    v-else-if="connected"
                    class="mt-2 text-xs text-[var(--md-on-surface-variant)]"
                  >
                    Connected and ready to start agent sessions.
                  </p>
                  <p
                    v-if="activeHostIsCloud"
                    class="mt-2 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                  >
                    Going offline closes this browser connection only. The
                    computer stays linked to this workspace until you remove it.
                  </p>
                </div>
                <div class="flex shrink-0 flex-wrap gap-1">
                  <UTooltip
                    v-if="!pinCredentialStatus.locked"
                    :text="
                      connected
                        ? 'Refresh agents'
                        : activeHostNeedsCredential
                          ? 'Enter access token'
                          : 'Reconnect'
                    "
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="soft"
                      :icon="
                        connected
                          ? iconRefresh
                          : activeHostNeedsCredential
                            ? iconKey
                            : iconConnect
                      "
                      :loading="hostActionPending"
                      @click="
                        activeHostNeedsCredential
                          ? focusReauthToken()
                          : retryConnection()
                      "
                    >
                      {{
                        connected
                          ? "Refresh"
                          : activeHostNeedsCredential
                            ? "Enter token"
                            : "Reconnect"
                      }}
                    </UButton>
                  </UTooltip>
                  <UTooltip
                    v-if="connected && !pinCredentialStatus.locked"
                    text="Close this browser connection without revoking access"
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="ghost"
                      color="neutral"
                      :icon="iconDisconnect"
                      aria-label="Go offline for now"
                      @click="goOfflineForNow"
                    >
                      Go offline for now
                    </UButton>
                  </UTooltip>
                  <UTooltip
                    v-if="activeHostIsCloud"
                    text="Revoke this workspace's access to the computer"
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="ghost"
                      color="error"
                      :icon="iconTrash"
                      :loading="hostActionPending"
                      @click="requestCloudComputerRemoval"
                    >
                      Remove computer
                    </UButton>
                  </UTooltip>
                  <UTooltip
                    v-if="
                      pinCredentialStatus.configured &&
                      !pinCredentialStatus.locked
                    "
                    text="Lock saved token"
                    :delay-duration="0"
                  >
                    <UButton
                      size="sm"
                      variant="ghost"
                      color="neutral"
                      square
                      :icon="iconLock"
                      aria-label="Lock saved token"
                      @click="lockSavedCredentials"
                    />
                  </UTooltip>
                </div>
              </div>

              <div
                v-if="activeHostIsCloud && cloudRemovalHostId === activeHost.id"
                class="mt-4 rounded-[var(--md-border-radius)] border border-[var(--md-error)] bg-[color-mix(in_srgb,var(--md-error)_6%,var(--md-surface-container-lowest))] p-4"
                data-testid="cloud-computer-removal-confirmation"
                role="alert"
              >
                <p class="text-sm font-semibold">
                  Remove {{ activeHost.name }}?
                </p>
                <p
                  class="mt-1 text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
                >
                  This revokes this workspace's remote access and removes the
                  computer from Agents. It does not uninstall or3-intern on the
                  computer.
                </p>
                <p
                  v-if="cloudRemovalError"
                  class="mt-2 text-xs text-[var(--md-error)]"
                  role="status"
                >
                  {{ cloudRemovalError }}
                </p>
                <div class="mt-3 flex flex-wrap justify-end gap-2">
                  <UButton
                    size="sm"
                    variant="soft"
                    color="neutral"
                    :disabled="hostActionPending"
                    @click="cancelCloudComputerRemoval"
                  >
                    Keep computer
                  </UButton>
                  <UButton
                    size="sm"
                    color="error"
                    :icon="iconTrash"
                    :loading="hostActionPending"
                    @click="removeCloudComputer"
                  >
                    Remove and revoke access
                  </UButton>
                </div>
              </div>

              <div
                v-if="pinCredentialStatus.locked"
                class="mt-4 overflow-hidden rounded-[var(--md-border-radius)] border border-[var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_5%,var(--md-surface-container-lowest))]"
              >
                <div class="flex items-start gap-3 p-4">
                  <span
                    class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
                  >
                    <UIcon :name="iconLock" class="size-4" />
                  </span>
                  <div>
                    <p class="text-sm font-semibold">Unlock saved token</p>
                    <p
                      class="mt-0.5 text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
                    >
                      Enter your device PIN to decrypt the token for this
                      browser session.
                    </p>
                  </div>
                </div>
                <div
                  class="grid gap-2 border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <UInput
                    v-model="unlockPin"
                    type="password"
                    inputmode="numeric"
                    autocomplete="current-password"
                    placeholder="Enter device PIN"
                    aria-label="Device PIN"
                    :icon="iconKey"
                    @keyup.enter="unlockAndReconnect"
                  />
                  <UButton
                    :icon="iconUnlock"
                    :loading="hostActionPending"
                    @click="unlockAndReconnect"
                  >
                    Unlock and reconnect
                  </UButton>
                  <UButton
                    class="justify-self-start sm:col-span-2"
                    size="xs"
                    variant="link"
                    color="error"
                    @click="clearSavedCredential"
                  >
                    Forget saved token
                  </UButton>
                </div>
              </div>

              <form
                v-else-if="activeHostNeedsCredential"
                class="mt-4 overflow-hidden rounded-[var(--md-border-radius)] border border-[var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_5%,var(--md-surface-container-lowest))]"
                aria-label="Reconnect trusted host"
                @submit.prevent="saveAndReconnect"
              >
                <div class="flex items-start gap-3 p-4">
                  <span
                    class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
                  >
                    <UIcon :name="iconKey" class="size-4" />
                  </span>
                  <div>
                    <p class="text-sm font-semibold">
                      Enter the token for {{ activeHost.name }}
                    </p>
                    <p
                      class="mt-0.5 text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
                    >
                      This updates only the selected trusted host. It will not
                      add or change another connection.
                    </p>
                  </div>
                </div>
                <div
                  class="space-y-3 border-t border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-3"
                >
                  <UInput
                    ref="reauthTokenInput"
                    v-model="reauthToken"
                    class="w-full"
                    type="password"
                    autocomplete="off"
                    placeholder="Access token"
                    aria-label="Token for selected host"
                    :icon="iconKey"
                    required
                  />
                  <div v-if="pinCredentialStatus.supported">
                    <UCheckbox
                      v-model="reauthRememberToken"
                      label="Remember this token on this device"
                    />
                    <p
                      class="mt-1 pl-7 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                    >
                      {{
                        reauthRememberToken
                          ? "Encrypt it with a device PIN so reconnect works after reload."
                          : "Session only — OR3 forgets it on reload."
                      }}
                    </p>
                    <div
                      v-if="reauthRememberToken"
                      class="mt-3 grid gap-2 sm:grid-cols-2"
                    >
                      <UInput
                        v-model="reauthPin"
                        type="password"
                        inputmode="numeric"
                        autocomplete="new-password"
                        placeholder="PIN (6+ digits)"
                        aria-label="Reconnect credential PIN"
                      />
                      <UInput
                        v-model="reauthPinConfirmation"
                        type="password"
                        inputmode="numeric"
                        autocomplete="new-password"
                        placeholder="Confirm PIN"
                        aria-label="Confirm reconnect credential PIN"
                      />
                    </div>
                  </div>
                  <div
                    class="flex flex-wrap items-center justify-between gap-2"
                  >
                    <p
                      v-if="formError"
                      class="text-xs text-[var(--md-error)]"
                      role="alert"
                    >
                      {{ formError }}
                    </p>
                    <UButton
                      class="ml-auto"
                      type="submit"
                      :icon="iconConnect"
                      :loading="hostActionPending"
                      :disabled="!reauthToken.trim()"
                    >
                      Save and reconnect
                    </UButton>
                  </div>
                </div>
              </form>
            </section>

            <section
              class="border-b border-[var(--md-outline-variant)] p-4 sm:p-5"
              aria-labelledby="connect-computer-title"
            >
              <div class="flex items-start gap-3">
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-[var(--md-border-radius)] bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
                >
                  <UIcon :name="iconInstall" class="size-4" />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3
                      id="connect-computer-title"
                      class="text-sm font-semibold"
                    >
                      Connect another computer
                    </h3>
                    <span
                      class="rounded-full bg-[var(--md-primary-container)] px-2 py-0.5 text-[10px] font-semibold text-[var(--md-on-primary-container)]"
                    >
                      Recommended
                    </span>
                  </div>
                  <p class="mt-0.5 text-xs text-[var(--md-on-surface-variant)]">
                    External-runtime Connect commands will appear after the
                    supporting Connect release is published.
                  </p>
                </div>
              </div>
              <p
                class="mt-2 text-[11px] text-[var(--md-on-surface-variant)]"
                aria-live="polite"
              >
                Until then, use Advanced to add a verified runtime by URL and
                token.
              </p>
            </section>

            <details
              ref="addHostDisclosure"
              class="group p-4 sm:p-5"
              data-testid="advanced-host-enrollment"
            >
              <summary
                class="cursor-pointer list-none rounded-[var(--md-border-radius)] font-medium focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]"
              >
                <span class="flex items-center gap-2 text-sm">
                  <UIcon
                    :name="iconChevronRight"
                    class="size-4 transition-transform group-open:rotate-90"
                  />
                  Advanced: add another host by URL and token
                </span>
              </summary>
              <form ref="addHostSection" class="mt-4" @submit.prevent="addHost">
                <p class="mb-4 text-xs text-[var(--md-on-surface-variant)]">
                  Connect an existing agent service directly. OR3 detects the
                  supported protocol automatically.
                </p>
                <div class="grid gap-3 sm:grid-cols-2">
                <label class="space-y-1.5">
                  <span class="text-xs font-medium">Name</span>
                  <UInput
                    v-model="hostName"
                    class="w-full"
                    placeholder="Host name"
                    aria-label="Host name"
                    :icon="iconTag"
                  />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-medium">Host URL</span>
                  <UInput
                    v-model="hostUrl"
                    class="w-full"
                    type="url"
                    placeholder="http://127.0.0.1:9100"
                    aria-label="Host URL"
                    :icon="iconLink"
                    required
                  />
                </label>
                <label class="space-y-1.5 sm:col-span-2">
                  <span class="text-xs font-medium">Access token</span>
                  <UInput
                    v-model="hostToken"
                    class="w-full"
                    type="password"
                    autocomplete="off"
                    placeholder="Access token"
                    aria-label="Access token"
                    :icon="iconKey"
                    required
                  />
                </label>
                </div>

                <div
                v-if="pinCredentialStatus.supported"
                class="mt-4 rounded-[var(--md-border-radius)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3"
              >
                <UCheckbox
                  v-model="rememberToken"
                  label="Remember token on this device"
                />
                <p
                  class="mt-1 pl-7 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                >
                  {{
                    rememberToken
                      ? "Encrypted with your PIN and stored only in this browser."
                      : "Session only — the token is forgotten when OR3 reloads."
                  }}
                </p>

                <div
                  v-if="rememberToken"
                  class="mt-3 border-t border-[var(--md-outline-variant)] pt-3"
                >
                  <div class="mb-3 flex items-start gap-2">
                    <UIcon
                      :name="iconShieldAlert"
                      class="mt-0.5 size-4 shrink-0 text-[var(--md-extended-color-warning-color)]"
                    />
                    <p
                      class="text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]"
                    >
                        <strong
                          class="font-semibold text-[var(--md-on-surface)]"
                        >Local encrypted storage.</strong
                      >
                      Use a unique PIN. A short or reused PIN may be
                      brute-forced if browser data is copied, and a forgotten
                      PIN cannot be recovered.
                    </p>
                  </div>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <UInput
                      v-model="credentialPin"
                      type="password"
                      inputmode="numeric"
                      autocomplete="new-password"
                      placeholder="PIN (6+ digits)"
                      aria-label="Credential PIN"
                      :icon="iconLock"
                    />
                    <UInput
                      v-model="credentialPinConfirmation"
                      type="password"
                      inputmode="numeric"
                      autocomplete="new-password"
                      placeholder="Confirm PIN"
                      aria-label="Confirm credential PIN"
                      :icon="iconCheck"
                    />
                  </div>
                </div>
                </div>
                <p
                v-else
                class="mt-3 text-xs text-[var(--md-on-surface-variant)]"
              >
                Session only: the token is forgotten when OR3 reloads and is
                never shown in conversations or Activity.
                </p>

                <div
                class="mt-4 flex flex-col-reverse gap-3 border-t border-[var(--md-outline-variant)] pt-4 sm:flex-row sm:items-center"
              >
                <p
                  v-if="formError"
                  class="min-w-0 flex-1 text-xs text-[var(--md-error)]"
                  role="alert"
                >
                  {{ formError }}
                </p>
                <p
                  v-else
                  class="min-w-0 flex-1 text-[11px] text-[var(--md-on-surface-variant)]"
                >
                  Credentials are sent in authorization headers, never URLs.
                </p>
                <UButton
                  type="submit"
                  class="justify-center sm:min-w-36"
                  :icon="iconConnect"
                  :loading="hostActionPending"
                >
                  Save and connect
                </UButton>
                </div>
              </form>
            </details>
          </div>
        </div>
      </template>
    </UModal>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  ExternalAgentRunStatus,
  ExternalAgentSessionRef,
} from "~/core/external-agents/types";
import {
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT,
  EXTERNAL_AGENT_LAUNCHER_REF,
  EXTERNAL_AGENT_PANE_APP_ID,
} from "~/core/external-agents/refs";
import { runnerUsability } from "~/core/external-agents/launcher";
import { useExternalAgentRuntime } from "~/core/external-agents/runtime";
import { useActiveSidebarPage } from "~/composables/sidebar/useActiveSidebarPage";
import { useIcon } from "~/composables/useIcon";
import { useThemeResolver } from "~/composables/useThemeResolver";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";
import {
  computeTimeGroup,
  formatTimeDisplay,
  getTimeGroupLabel,
  type TimeGroup,
} from "~/utils/sidebar/sidebarTimeUtils";

interface HistoryItem {
  key: string;
  recordId: string;
  hostId: string;
  remoteSessionId: string;
  title: string;
  runnerLabel: string;
  updatedAt: string;
  status: ExternalAgentRunStatus;
  pendingApprovalCount: number;
  preview?: string;
  timeGroup: TimeGroup;
  timeLabel: string;
}

const iconChevronLeft = useIcon("ui.chevron.left");
const iconChevronRight = useIcon("ui.chevron.right");
const iconSettings = useIcon("ui.settings");
const iconBot = useIcon("external-agent.bot");
const iconSearch = useIcon("ui.search");
const iconSearchEmpty = useIcon("external-agent.search.empty");
const iconLoading = useIcon("ui.loading");
const iconShieldAlert = useIcon("external-agent.shield.alert");
const iconShieldCheck = useIcon("external-agent.shield.check");
const iconWarning = useIcon("ui.warning");
const iconNetwork = useIcon("external-agent.network");
const iconPlus = useIcon("ui.plus");
const iconServer = useIcon("external-agent.server");
const iconServerOff = useIcon("external-agent.server.off");
const iconCheck = useIcon("ui.check");
const iconRefresh = useIcon("ui.refresh");
const iconKey = useIcon("external-agent.key");
const iconConnect = useIcon("external-agent.connect");
const iconDisconnect = useIcon("external-agent.disconnect");
const iconTrash = useIcon("ui.trash");
const iconLock = useIcon("ui.lock");
const iconUnlock = useIcon("ui.unlock");
const iconInstall = useIcon("external-agent.install");
const iconTag = useIcon("external-agent.tag");
const iconLink = useIcon("external-agent.link");

const runtime = useExternalAgentRuntime();
const controller = runtime.controller;
const snapshot = runtime.snapshot;
const { setActivePage } = useActiveSidebarPage();
const { activeTheme } = useThemeResolver();
const usesTexturedSidebarTreatment = computed(
  () => activeTheme.value === "retro" || activeTheme.value === "cyberpunk",
);
const query = ref("");
const showConnections = ref(false);
const hostName = ref("");
const hostUrl = ref("http://127.0.0.1:9100");
const hostToken = ref("");
const rememberToken = ref(false);
const credentialPin = ref("");
const credentialPinConfirmation = ref("");
const reauthToken = ref("");
const reauthRememberToken = ref(false);
const reauthPin = ref("");
const reauthPinConfirmation = ref("");
const unlockPin = ref("");
const hostSwitcherOpen = ref(false);
const quickUnlockPin = ref("");
const quickSwitchError = ref<string | null>(null);
const quickHostPending = ref(false);
const pendingQuickHostId = ref<string | null>(null);
const credentialStateVersion = ref(0);
const hostActionPending = ref(false);
const formError = ref<string | null>(null);
const cloudRemovalHostId = ref<string | null>(null);
const cloudRemovalError = ref<string | null>(null);
const collapsed = ref(new Set<TimeGroup>());
const addHostSection = ref<HTMLElement | null>(null);
const addHostDisclosure = ref<HTMLDetailsElement | null>(null);
const reauthTokenInput = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);

const pinCredentialStatus = computed(() => {
  credentialStateVersion.value;
  return (
    controller?.pinCredentialStatus ?? {
      supported: false as const,
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    }
  );
});
const connected = computed(
  () =>
    snapshot.value?.connectionState === "online" ||
    snapshot.value?.connectionState === "degraded",
);
const hasAvailableRunner = computed(() =>
  (snapshot.value?.runners ?? []).some(
    (runner) => runnerUsability(runner).usable,
  ),
);
const hostItems = computed(() =>
  (snapshot.value?.hosts ?? []).map((host) => ({
    value: host.id,
    label: host.name,
    description: `${host.driver === "runs" ? "Agent service" : "OR3 Intern"} · ${host.baseUrl}`,
  })),
);
const activeHost = computed(
  () =>
    snapshot.value?.hosts.find(
      (host) => host.id === snapshot.value?.activeHostId,
    ) ?? null,
);
const activeHostIsCloud = computed(
  () => activeHost.value?.id.startsWith("or3-connect:") === true,
);
const activeDriverLabel = computed(() =>
  activeHost.value?.driver === "runs" ? "Sessions + Runs" : "OR3 Intern",
);
const activeRuntimeLabel = computed(() => {
  const displayName = snapshot.value?.capabilities?.runtimeDisplayName;
  if (typeof displayName === "string" && displayName.trim()) return displayName;
  const product = snapshot.value?.capabilities?.runtimeProduct;
  if (typeof product !== "string" || !product.trim()) return "Agent service";
  return product
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
});
const activeHostNeedsCredential = computed(
  () =>
    Boolean(activeHost.value) &&
    !pinCredentialStatus.value.locked &&
    !connected.value &&
    /credential|required|access token|unauthori[sz]ed/i.test(
      snapshot.value?.connectionError ?? "",
    ),
);
const connectionStatusLabel = computed(() => {
  if (pinCredentialStatus.value.locked) return "Locked";
  if (snapshot.value?.connectionState === "connecting") return "Connecting";
  if (snapshot.value?.connectionState === "degraded") return "Limited";
  if (snapshot.value?.connectionState === "online") return "Connected";
  if (snapshot.value?.connectionState === "offline") return "Offline";
  return "Disconnected";
});
const connectionStatusClasses = computed(() => {
  if (connected.value) {
    return "bg-[color-mix(in_srgb,var(--md-extended-color-success-color)_14%,transparent)] text-[var(--md-extended-color-success-color)]";
  }
  if (snapshot.value?.connectionState === "connecting") {
    return "bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]";
  }
  return "bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)]";
});
const activeHostName = computed(
  () =>
    snapshot.value?.hosts.find(
      (host) => host.id === snapshot.value?.activeHostId,
    )?.name ?? "No agent host",
);
const connectionNotice = computed(() => {
  if (!snapshot.value?.hosts.length) return "Connect an agent host";
  if (!connected.value)
    return snapshot.value.connectionError ?? "Agent host disconnected";
  if (!hasAvailableRunner.value) return "No agents are ready";
  return null;
});
const runnerNames = computed(
  () =>
    new Map(
      (snapshot.value?.runners ?? []).map((runner) => [
        runner.id,
        runner.display_name,
      ]),
    ),
);
const activeRecordId = computed(() => {
  const api = getGlobalMultiPaneApi();
  const pane = api?.panes.value[api.activePaneIndex.value];
  return pane?.mode === EXTERNAL_AGENT_PANE_APP_ID
    ? (pane.documentId ?? null)
    : null;
});
const history = computed<HistoryItem[]>(() => {
  const activeHostId = snapshot.value?.activeHostId;
  if (!activeHostId) return [];
  const refs = new Map<string, ExternalAgentSessionRef>();
  for (const item of snapshot.value?.sessionRefs ?? []) {
    if (item.hostId !== activeHostId) continue;
    refs.set(`${item.hostId}:${item.remoteSessionId}`, item);
  }
  for (const session of snapshot.value?.sessions ?? []) {
    if (session.hostId !== activeHostId) continue;
    refs.set(`${session.hostId}:${session.remoteSessionId}`, {
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
      title: session.title,
      runnerId: session.runnerId,
      updatedAt: session.updatedAt,
      status: session.status,
      pendingApprovalCount: session.approvals.filter(
        (approval) => approval.status === "pending",
      ).length,
      preview:
        session.output ??
        session.turns.at(-1)?.final_text ??
        session.turns.at(-1)?.user_message,
    });
  }
  return [...refs.values()]
    .map((item) => {
      const updatedAt = item.updatedAt ?? new Date(0).toISOString();
      const timestamp = Number.isFinite(Date.parse(updatedAt))
        ? Date.parse(updatedAt) / 1000
        : 0;
      const timeGroup = computeTimeGroup(timestamp);
      return {
        key: `${item.hostId}:${item.remoteSessionId}`,
        recordId: encodeExternalAgentSessionRef(item),
        hostId: item.hostId,
        remoteSessionId: item.remoteSessionId,
        title: item.title?.trim() || "Untitled agent session",
        runnerLabel:
          runnerNames.value.get(item.runnerId ?? "") ??
          item.runnerId ??
          "Agent",
        updatedAt,
        status: item.status ?? "succeeded",
        pendingApprovalCount: item.pendingApprovalCount ?? 0,
        preview: item.preview?.slice(0, 240),
        timeGroup,
        timeLabel: formatTimeDisplay(timestamp, timeGroup),
      };
    })
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
});
const filteredHistory = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return history.value;
  return history.value.filter((item) =>
    [item.title, item.runnerLabel, item.preview]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
});
const groupedHistory = computed(() => {
  const order: TimeGroup[] = [
    "today",
    "yesterday",
    "earlierThisWeek",
    "thisMonth",
    "older",
  ];
  return order
    .map((key) => ({
      key,
      label: getTimeGroupLabel(key),
      items: filteredHistory.value.filter((item) => item.timeGroup === key),
    }))
    .filter((group) => group.items.length);
});
const runningCount = computed(
  () =>
    history.value.filter(
      (item) => item.status === "running" || item.status === "queued",
    ).length,
);
const approvalCount = computed(() =>
  history.value.reduce((total, item) => total + item.pendingApprovalCount, 0),
);

function statusText(status: ExternalAgentRunStatus) {
  if (status === "waiting_approval") return "needs approval";
  if (status === "succeeded") return "completed";
  return status;
}

function toggleGroup(group: TimeGroup) {
  const next = new Set(collapsed.value);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  collapsed.value = next;
}

async function focusAddHost() {
  if (addHostDisclosure.value) addHostDisclosure.value.open = true;
  await nextTick();
  addHostSection.value?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  addHostSection.value
    ?.querySelector<HTMLInputElement>('[aria-label="Host name"]')
    ?.focus();
}

function validatedPersistencePin(
  remember: boolean,
  pin: string,
  confirmation: string,
): string | undefined {
  if (!remember) return undefined;
  if (pin !== confirmation) {
    throw new Error("The PIN confirmation does not match.");
  }
  if (!/^\d{6,}$/.test(pin.trim())) {
    throw new Error("Use a PIN with at least 6 digits.");
  }
  return pin.trim();
}

function requestedPersistencePin(): string | undefined {
  return validatedPersistencePin(
    rememberToken.value,
    credentialPin.value,
    credentialPinConfirmation.value,
  );
}

function requestedReauthPersistencePin(): string | undefined {
  return validatedPersistencePin(
    reauthRememberToken.value,
    reauthPin.value,
    reauthPinConfirmation.value,
  );
}

function clearCredentialForm() {
  hostToken.value = "";
  credentialPin.value = "";
  credentialPinConfirmation.value = "";
  unlockPin.value = "";
  rememberToken.value = false;
  credentialStateVersion.value += 1;
}

function clearReauthForm() {
  reauthToken.value = "";
  reauthRememberToken.value = false;
  reauthPin.value = "";
  reauthPinConfirmation.value = "";
}

async function openRecord(recordId: string) {
  const api = getGlobalMultiPaneApi();
  if (!api) {
    formError.value = "The workspace pane host is unavailable.";
    return;
  }
  const index = api.activePaneIndex.value;
  if (api.panes.value[index]) {
    await api.setPaneApp(index, EXTERNAL_AGENT_PANE_APP_ID, { recordId });
  } else {
    await api.newPaneForApp(EXTERNAL_AGENT_PANE_APP_ID, {
      initialRecordId: recordId,
    });
  }
}

async function openHistory(item: HistoryItem) {
  await openRecord(item.recordId);
}

async function openLauncher() {
  await openRecord(EXTERNAL_AGENT_LAUNCHER_REF);
}

async function addHost() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await controller.addTrustedHost({
      name: hostName.value,
      baseUrl: hostUrl.value,
      token: hostToken.value,
      persistencePin: requestedPersistencePin(),
    });
    clearCredentialForm();
    hostName.value = "";
    showConnections.value = false;
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Host enrollment failed";
  } finally {
    hostActionPending.value = false;
  }
}

async function retryConnection() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await runtime.refreshCloudHosts?.();
    const didConnect = await controller.reconnect();
    if (didConnect) {
      return;
    }
    formError.value = controller.snapshot.connectionError ?? "Reconnect failed";
    await nextTick();
    focusReauthToken();
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Reconnect failed";
  } finally {
    hostActionPending.value = false;
  }
}

async function saveAndReconnect() {
  if (!controller || !reauthToken.value.trim()) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    const didConnect = await controller.reconnect(
      reauthToken.value.trim(),
      requestedReauthPersistencePin(),
    );
    if (!didConnect) {
      formError.value =
        controller.snapshot.connectionError ?? "Reconnect failed";
      return;
    }
    clearReauthForm();
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Reconnect failed";
  } finally {
    hostActionPending.value = false;
  }
}

function focusReauthToken() {
  const target = reauthTokenInput.value;
  const element =
    target instanceof HTMLElement
      ? target
      : target?.$el instanceof HTMLElement
        ? target.$el
        : null;
  (element?.matches("input")
    ? element
    : element?.querySelector("input")
  )?.focus();
}

function openConnections() {
  showConnections.value = true;
}

function goOfflineForNow() {
  formError.value = null;
  cloudRemovalHostId.value = null;
  cloudRemovalError.value = null;
  controller?.disconnect();
}

function requestCloudComputerRemoval() {
  if (!activeHostIsCloud.value || !activeHost.value) return;
  cloudRemovalHostId.value = activeHost.value.id;
  cloudRemovalError.value = null;
}

function cancelCloudComputerRemoval() {
  if (hostActionPending.value) return;
  cloudRemovalHostId.value = null;
  cloudRemovalError.value = null;
}

async function removeCloudComputer() {
  if (!controller || !activeHost.value) return;
  const host = activeHost.value;
  const environmentId = host.id.startsWith("or3-connect:")
    ? host.id.slice("or3-connect:".length).trim()
    : "";
  if (!environmentId || cloudRemovalHostId.value !== host.id) return;

  hostActionPending.value = true;
  formError.value = null;
  cloudRemovalError.value = null;
  let accessRevoked = false;
  try {
    const response = await globalThis.fetch(
      "/api/connect/environments/remove",
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Or3-Connect-Intent": "remove",
        },
        body: JSON.stringify({ environmentId }),
      },
    );
    if (!response.ok) {
      throw new Error(await readCloudComputerRemovalError(response));
    }
    accessRevoked = true;
    cloudRemovalHostId.value = null;
    if (runtime.refreshCloudHosts) {
      await runtime.refreshCloudHosts();
    } else {
      await controller.forgetHost(host.id);
    }
  } catch (cause) {
    if (accessRevoked) {
      cloudRemovalHostId.value = null;
      formError.value =
        "Access was revoked, but the computer list could not refresh. Use Refresh to update it.";
    } else {
      cloudRemovalHostId.value = host.id;
      cloudRemovalError.value =
        cause instanceof Error
          ? cause.message
          : "Cloud access was not confirmed revoked. The computer stays listed so you can retry.";
    }
  } finally {
    hostActionPending.value = false;
  }
}

async function readCloudComputerRemovalError(
  response: Response,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      statusMessage?: unknown;
      message?: unknown;
    };
    const message =
      typeof payload.statusMessage === "string"
        ? payload.statusMessage.trim()
        : typeof payload.message === "string"
          ? payload.message.trim()
          : "";
    if (message) return message;
  } catch {
    // Fall through to a stable, non-sensitive retry message.
  }
  return "Cloud access was not confirmed revoked. The computer stays listed so you can retry.";
}

async function unlockAndReconnect() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await controller.unlockCredentials(unlockPin.value);
    credentialStateVersion.value += 1;
    const didConnect = await controller.reconnect();
    if (!didConnect) {
      formError.value =
        controller.snapshot.connectionError ?? "Reconnect failed";
    } else {
      unlockPin.value = "";
    }
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Could not unlock the token";
  } finally {
    hostActionPending.value = false;
  }
}

function lockSavedCredentials() {
  controller?.lockCredentials();
  credentialStateVersion.value += 1;
}

async function clearSavedCredential() {
  if (!controller) return;
  hostActionPending.value = true;
  formError.value = null;
  try {
    await controller.clearActiveHostCredential();
    clearCredentialForm();
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Could not remove the token";
  } finally {
    hostActionPending.value = false;
  }
}

async function switchHost(value: string) {
  formError.value = null;
  clearReauthForm();
  try {
    await controller?.switchHost(value);
  } catch (cause) {
    formError.value =
      cause instanceof Error ? cause.message : "Host switch failed";
  }
}

async function quickSwitchHost(hostId: string) {
  if (!controller) return;
  quickSwitchError.value = null;
  pendingQuickHostId.value = hostId;
  if (pinCredentialStatus.value.locked) return;
  quickHostPending.value = true;
  try {
    const connected = await controller.switchHost(hostId);
    if (!connected) {
      quickSwitchError.value =
        controller.snapshot.connectionError ?? "Host switch failed";
      return;
    }
    pendingQuickHostId.value = null;
    hostSwitcherOpen.value = false;
  } catch (cause) {
    quickSwitchError.value =
      cause instanceof Error ? cause.message : "Host switch failed";
  } finally {
    quickHostPending.value = false;
  }
}

async function quickUnlockHosts() {
  if (!controller) return;
  quickHostPending.value = true;
  quickSwitchError.value = null;
  try {
    await controller.unlockCredentials(quickUnlockPin.value);
    credentialStateVersion.value += 1;
    quickUnlockPin.value = "";
    const hostId = pendingQuickHostId.value ?? snapshot.value?.activeHostId;
    if (hostId) await quickSwitchHost(hostId);
  } catch (cause) {
    quickSwitchError.value =
      cause instanceof Error ? cause.message : "Could not unlock saved hosts";
  } finally {
    quickHostPending.value = false;
  }
}

onMounted(() => {
  window.addEventListener(
    EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT,
    openConnections,
  );
});

onBeforeUnmount(() => {
  window.removeEventListener(
    EXTERNAL_AGENT_OPEN_CONNECTIONS_EVENT,
    openConnections,
  );
});
</script>

<style scoped>
.external-agents-sidebar {
  container-type: inline-size;
  --agent-sidebar-muted: var(--md-on-surface-variant);
  --agent-sidebar-panel: var(--md-surface-container-low);
  --agent-sidebar-row-hover: var(--md-surface-hover);
  --agent-sidebar-row-active: var(--md-surface-active);
}

.external-agents-sidebar--textured {
  --agent-sidebar-muted: color-mix(
    in srgb,
    var(--md-on-surface) 72%,
    var(--md-surface)
  );
  --agent-sidebar-panel: color-mix(in srgb, var(--md-surface) 76%, transparent);
  --agent-sidebar-row-hover: color-mix(
    in srgb,
    var(--md-primary) 9%,
    var(--md-surface)
  );
  --agent-sidebar-row-active: color-mix(
    in srgb,
    var(--md-primary) 16%,
    var(--md-surface)
  );
  color: var(--md-on-surface);
  backdrop-filter: blur(8px) saturate(0.92);
}

.external-agents-sidebar--textured .agent-sidebar-header {
  background: color-mix(in srgb, var(--md-surface) 46%, transparent);
  backdrop-filter: blur(10px) saturate(0.92);
}

.external-agents-sidebar--retro {
  background: color-mix(in srgb, var(--md-surface) 32%, transparent);
}

.external-agents-sidebar--retro .agent-sidebar-header {
  background: color-mix(in srgb, var(--md-surface) 28%, transparent);
  border-bottom: 0;
}

.external-agents-sidebar--cyberpunk {
  background: color-mix(in srgb, var(--md-surface) 46%, transparent);
}

.external-agents-sidebar--cyberpunk .agent-sidebar-header {
  border-bottom: 1px solid
    color-mix(in srgb, var(--md-primary) 24%, transparent);
}

.external-agents-sidebar--textured :deep(.agent-sidebar-header-button) {
  color: var(--md-on-surface) !important;
  background: color-mix(in srgb, var(--md-surface) 72%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--md-outline) 30%, transparent) !important;
}

.external-agents-sidebar--textured :deep(.agent-sidebar-header-button:hover) {
  background: var(--agent-sidebar-row-hover) !important;
  border-color: color-mix(
    in srgb,
    var(--md-primary) 50%,
    var(--md-outline)
  ) !important;
}

.external-agents-sidebar--textured :deep(.agent-new-button) {
  color: var(--md-on-surface) !important;
  background: color-mix(
    in srgb,
    var(--md-primary) 16%,
    var(--md-surface)
  ) !important;
  border: var(--md-border-width) solid
    color-mix(in srgb, var(--md-primary) 72%, var(--md-outline)) !important;
}

.external-agents-sidebar--textured :deep(.agent-new-button:hover) {
  background: color-mix(
    in srgb,
    var(--md-primary) 24%,
    var(--md-surface)
  ) !important;
}

.external-agents-sidebar--textured :deep(.agent-sidebar-search input) {
  color: var(--md-on-surface) !important;
  background: color-mix(in srgb, var(--md-surface) 82%, transparent) !important;
  backdrop-filter: blur(10px);
}

.external-agents-sidebar--textured
  :deep(.agent-sidebar-search input::placeholder) {
  color: var(--agent-sidebar-muted) !important;
  opacity: 1;
}

.agent-connection-notice {
  color: var(--md-on-surface);
  background: var(--agent-sidebar-panel);
  border: 1px solid color-mix(in srgb, var(--md-outline) 30%, transparent);
  box-shadow: 0 2px 10px rgb(0 0 0 / 7%);
  backdrop-filter: blur(10px) saturate(0.9);
}

.agent-connection-notice-copy {
  color: var(--md-on-surface);
}

:deep(.agent-connection-fix) {
  color: var(--md-primary) !important;
  font-weight: 650;
}

.agent-session-row {
  color: var(--md-on-surface);
}

.agent-session-row:hover {
  background: var(--agent-sidebar-row-hover);
}

.agent-session-row[aria-current="page"] {
  color: var(--md-on-surface);
  background: var(--agent-sidebar-row-active);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--md-primary) 20%, transparent);
}

.agent-session-preview,
.agent-session-time {
  color: var(--agent-sidebar-muted);
}

.agent-session-meta {
  color: var(--agent-sidebar-muted);
  opacity: 0.82;
}

:deep(.external-agents-sidebar .sb-group-header-label) {
  color: var(--agent-sidebar-muted);
}

:deep(.external-agents-sidebar .sb-group-header-icon) {
  color: var(--agent-sidebar-muted);
  opacity: 0.82;
}

.agent-sidebar-footer {
  color: var(--md-on-surface);
  background: color-mix(in srgb, var(--md-surface) 58%, transparent);
  border-color: color-mix(in srgb, var(--md-outline) 30%, transparent);
  backdrop-filter: blur(6px);
}

.agent-sidebar-footer > span {
  color: inherit;
}

@container (max-width: 15.5rem) {
  .agent-new-button-label {
    display: none;
  }

  :deep(.agent-new-button) {
    width: 2.25rem;
    min-width: 2.25rem;
    padding-inline: 0 !important;
  }
}
</style>
