<template>
    <div class="space-y-6">
        <!-- Workspace Selector Modal - shown if no workspace selected -->
        <WorkspaceSelector
            v-model="showWorkspaceSelector"
            @select="onWorkspaceSelected"
        />

        <div>
            <div class="mb-1 flex flex-wrap items-center gap-2">
                <h2 class="text-2xl font-semibold">Plugins</h2>
                <UBadge v-if="workspaceContextName" color="neutral" variant="soft">
                    {{ workspaceContextName }}
                </UBadge>
            </div>
            <p class="text-sm opacity-70">
                Install marketplace packages on this site, then activate them for
                a workspace. Runtime diagnostics are available below.
            </p>
        </div>

        <nav class="flex flex-wrap gap-2" aria-label="Plugin management sections">
            <UButton v-if="canManageSitePlugins" size="sm" color="neutral" variant="soft" to="#site-plugin-catalog">Site catalog</UButton>
            <UButton v-if="canManageSitePlugins && v2Packages.length" size="sm" color="neutral" variant="soft" to="#managed-v2">Installed packages</UButton>
            <UButton size="sm" color="neutral" variant="soft" to="/chat?dashboard=marketplace&page=updates">Updates</UButton>
        </nav>

        <div class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4">
            <div>
                <h3 class="text-base font-medium">Marketplace</h3>
                <p class="text-sm opacity-70">
                    Browse and install reviewed plugins in Chat’s Dashboard.
                    Sign in with your Chat account; the admin login is separate.
                </p>
            </div>
            <UButton to="/chat?dashboard=marketplace" icon="i-lucide-store">
                Browse Marketplace
            </UButton>
        </div>

        <section v-if="canManageSitePlugins" id="site-plugin-catalog" class="min-w-0 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 class="text-lg font-medium">Site catalog approvals</h3>
                    <p class="text-sm opacity-70">Only approved releases appear in Dashboard &gt; Marketplace. Removing approval stops new discovery and enablement; it does not disable workspaces already using the plugin.</p>
                </div>
                <UButton size="sm" color="neutral" variant="soft" :loading="siteCatalogLoading" @click="loadSiteCatalog">Refresh catalog</UButton>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
                <UInput v-model="siteCatalogSearch" class="min-w-0 flex-1" placeholder="Search the registry" aria-label="Search registry plugins" @keyup.enter="searchSiteCatalog" />
                <UButton size="sm" @click="searchSiteCatalog">Search</UButton>
            </div>
            <p v-if="siteCatalogError" class="mt-3 text-sm text-[var(--md-sys-color-error,#b91c1c)] break-words" role="alert">{{ siteCatalogError }}</p>
            <p v-else-if="siteCatalogLoaded && !siteCatalogConfigured" class="mt-3 text-sm opacity-70">Configure the trusted marketplace registry and release keys to review plugins.</p>
            <p v-else-if="siteCatalogLoaded && siteCatalogCards.length === 0" class="mt-3 text-sm opacity-70">No registry plugins match this search.</p>
            <ul v-else class="mt-3 space-y-2">
                <li v-for="card in siteCatalogCards" :key="card.pluginId" class="min-w-0 rounded border border-[var(--md-outline-variant)] p-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="font-medium break-words">{{ card.name || card.pluginId }}</div>
                            <div class="text-xs opacity-70 break-words">{{ card.summary }}</div>
                            <div class="mt-1 text-xs">Published: {{ card.latestRelease?.version ?? 'none' }} · Approved: {{ sitePolicyFor(card.pluginId)?.catalogVisible ? sitePolicyFor(card.pluginId)?.approvedRelease.version : 'none' }} · New workspaces: {{ sitePolicyFor(card.pluginId)?.futureDefaultEnabled ? 'enabled by default' : 'no default' }}</div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton size="xs" :disabled="!card.latestRelease?.version || siteCatalogBusy === card.pluginId" :loading="siteCatalogBusy === card.pluginId" @click="reviewSiteRelease(card.pluginId, card.latestRelease?.version)">Review &amp; approve</UButton>
                            <UButton v-if="sitePolicyFor(card.pluginId)?.catalogVisible" size="xs" color="neutral" variant="soft" :disabled="siteCatalogBusy === card.pluginId" @click="hideSiteRelease(card.pluginId)">Remove from catalog</UButton>
                        </div>
                    </div>
                </li>
            </ul>
            <div v-if="siteCatalogTotal > siteCatalogCards.length" class="mt-3 flex items-center gap-3">
                <UButton size="xs" color="neutral" variant="soft" :disabled="siteCatalogPage <= 1 || siteCatalogLoading" @click="changeSiteCatalogPage(-1)">Previous</UButton>
                <span class="text-xs">Page {{ siteCatalogPage }} of {{ Math.max(1, Math.ceil(siteCatalogTotal / 24)) }}</span>
                <UButton size="xs" color="neutral" variant="soft" :disabled="siteCatalogPage >= Math.ceil(siteCatalogTotal / 24) || siteCatalogLoading" @click="changeSiteCatalogPage(1)">Next</UButton>
            </div>
        </section>

        <details class="min-w-0 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium">Advanced source plugins and development admission</summary>
            <div class="space-y-4 border-t border-[var(--md-outline-variant)] p-4">
        <PluginDevelopmentAdmission />

        <div
            v-if="rebuildRequired && rebuildAvailable"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]"
        >
            <div class="font-semibold text-sm">Rebuild + Restart Required</div>
            <div class="text-xs opacity-80 mt-1">
                Newly installed source plugins are bundled at build time. In production, run
                Rebuild + Restart from Admin &gt; System before enabling them. In development,
                restart the dev server to pick up new client modules.
            </div>
        </div>

        <div
            v-if="extensionInstallDisabled"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
        >
            <div class="text-sm">
                Direct source plugin upload and install are disabled on this managed deployment.
                This image is immutable and cannot rebuild source extensions.
            </div>
            <div class="text-xs opacity-70 mt-1">
                Reviewed packages can still be installed from the Marketplace. To install
                source extensions, deploy OR3 from source and restart after installing.
            </div>
        </div>

        <div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 class="text-lg font-medium">Source plugins</h3>
                    <p class="text-xs opacity-70">
                        Add or uninstall site-wide; activate per workspace.
                    </p>
                </div>
                <div v-if="canManageSitePlugins && extensionInstallEnabled" class="flex flex-wrap items-center gap-2">
                     <!-- Input hidden mostly, custom button triggers it -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".zip"
                        class="hidden"
                        :disabled="fileInstalling"
                        @change="requestPluginFileInstall"
                    />
                    <UButton size="sm" :disabled="urlInstalling || fileInstalling" @click="showUrlModal = true" icon="i-heroicons-link">
                        Add from URL
                    </UButton>
                    <UButton size="sm" :disabled="fileInstalling || urlInstalling" :loading="fileInstalling" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Add from .zip
                    </UButton>
                </div>
            </div>

            <!-- URL Import Modal -->
            <AdminUrlImportModal v-model="showUrlModal" label="Plugin" :loading="urlInstalling" :code-trust-warning="true" @install="installPluginFromUrl" />

            <div
                v-if="configuredPluginModules.length > 0"
                class="mb-4 p-3 text-xs rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
            >
                Some plugins are configured via package modules in config and require install + rebuild/restart:
                <span class="font-mono">{{ configuredPluginModules.join(', ') }}</span>
            </div>

            <div v-if="pending" class="space-y-4 animate-pulse">
                <div class="h-10 bg-[var(--md-surface-container-highest)] rounded w-full"></div>
                <div class="h-24 bg-[var(--md-surface-container-highest)] rounded w-full"></div>
                <div class="h-24 bg-[var(--md-surface-container-highest)] rounded w-full"></div>
            </div>

            <div v-else-if="plugins.length === 0" class="text-sm opacity-70 py-8 text-center bg-[var(--md-surface-container-low)] rounded">
                No source plugins installed. Use Dashboard &gt; Marketplace for reviewed packages.
            </div>

            <div v-else class="space-y-4">
                <div
                    v-for="plugin in plugins"
                    :key="plugin.id"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] hover:bg-[var(--md-surface-container-low)] transition-colors"
                >
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="min-w-0">
                            <div class="font-semibold text-base">{{ plugin.name }}</div>
                            <div class="text-xs opacity-70 font-mono mt-0.5">{{ plugin.id }} • v{{ plugin.version }}</div>
                            <div v-if="plugin.description" class="mt-2 text-sm opacity-80 max-w-2xl">
                                {{ plugin.description }}
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge :color="enabledSet.has(plugin.id) ? 'success' : 'neutral'" variant="subtle">
                                {{ enabledSet.has(plugin.id) ? 'Active' : 'Inactive' }}
                            </UBadge>
                        </div>
                    </div>

                    <div class="mt-4 pt-4 border-t border-[var(--md-outline-variant)]/50 flex flex-wrap items-center gap-2">
                        <UButton
                            size="sm"
                            :color="enabledSet.has(plugin.id) ? 'neutral' : 'primary'"
                            :variant="enabledSet.has(plugin.id) ? 'soft' : 'solid'"
                            :disabled="!isOwner || toggleLoading[plugin.id]"
                            :loading="toggleLoading[plugin.id]"
                            @click="togglePlugin(plugin.id)"
                        >
                            {{ enabledSet.has(plugin.id) ? 'Deactivate' : 'Activate' }}
                        </UButton>
                        <UButton
                            size="sm"
                            color="error"
                            variant="ghost"
                            :disabled="!canManageSitePlugins"
                            @click="uninstallPlugin(plugin.id)"
                        >
                            Uninstall
                        </UButton>
                        
                        <div class="flex-1"></div>

                        <UPopover
                            :content="{
                                side: 'left',
                                align: 'end',
                                sideOffset: 8,
                                collisionPadding: 16,
                            }"
                        >
                            <UButton color="neutral" variant="ghost" size="sm" label="Advanced" trailing-icon="i-heroicons-chevron-down-20-solid" />
                            <template #content>
                                <div class="p-4 w-80 max-h-[min(28rem,calc(100vh-4rem))] overflow-y-auto space-y-3">
                                    <div class="text-xs font-semibold uppercase opacity-60">Access policy</div>
                                    <div class="space-y-2 p-2 rounded border border-[var(--md-outline-variant)]/50">
                                        <label class="flex items-center gap-2 text-xs">
                                            <input
                                                v-model="getAccessEditor(plugin.id).authRequired"
                                                type="checkbox"
                                                :disabled="!isOwner"
                                            />
                                            Require authentication
                                        </label>

                                        <label class="flex flex-col gap-1 text-xs">
                                            <span>Required tier</span>
                                            <select
                                                v-model="getAccessEditor(plugin.id).tier"
                                                class="border rounded px-2 py-1 bg-[var(--md-surface)]"
                                                :disabled="!isOwner"
                                            >
                                                <option value="">None</option>
                                                <option value="paid">paid</option>
                                                <option value="enterprise">enterprise</option>
                                            </select>
                                        </label>

                                        <label class="flex flex-col gap-1 text-xs">
                                            <span>Required role</span>
                                            <select
                                                v-model="getAccessEditor(plugin.id).role"
                                                class="border rounded px-2 py-1 bg-[var(--md-surface)]"
                                                :disabled="!isOwner"
                                            >
                                                <option value="">Any</option>
                                                <option value="owner">owner</option>
                                                <option value="editor">editor</option>
                                                <option value="viewer">viewer</option>
                                            </select>
                                        </label>

                                        <p class="text-[11px] opacity-70">
                                            Server enforces access policy. Admin overrides win over plugin defaults.
                                        </p>
                                    </div>

                                    <div class="text-xs font-semibold uppercase opacity-60">Configuration (JSON)</div>
                                    <UTextarea
                                        v-model="settingsByPlugin[plugin.id]"
                                        :rows="6"
                                        size="xs"
                                        :disabled="!isOwner"
                                        placeholder="{}"
                                        class="font-mono text-xs"
                                        @focus="loadSettings(plugin.id)"
                                    />
                                    <UButton
                                        size="xs"
                                        block
                                        :disabled="!isOwner"
                                        @click="saveSettings(plugin.id)"
                                    >
                                        Save Configuration
                                    </UButton>
                                </div>
                            </template>
                        </UPopover>
                    </div>
                </div>
            </div>
        </div>

            </div>
        </details>

        <div id="managed-v2"
            v-if="canManageSitePlugins && v2Packages.length > 0"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]"
        >
            <div class="mb-4">
                <h3 class="text-lg font-medium">Installed packages</h3>
                <p class="text-xs opacity-70">
                    The selected version is shared by the site. Enablement and setup are managed per workspace.
                </p>
            </div>
            <div class="space-y-3">
                <div
                    v-for="packagePlugin in v2Packages"
                    :key="packagePlugin.pluginId"
                    class="min-w-0 p-3 rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)]"
                >
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="min-w-0">
                            <div class="font-semibold break-words">{{ packagePlugin.pluginId }}</div>
                            <div class="mt-1 text-sm">Selected version: {{ packagePlugin.display?.version ?? 'Unavailable' }}</div>
                            <div v-if="packagePlugin.pointer?.candidate" class="text-sm">Update being checked: {{ packagePlugin.display?.candidateVersion ?? 'Version unavailable' }}</div>
                            <div v-if="packagePlugin.localAdmission || packagePlugin.adminUpload" class="mt-1">
                                <UBadge color="warning" variant="subtle">{{ packagePlugin.localAdmission ? 'Development candidate' : 'Admin ZIP upload' }}</UBadge>
                            </div>
                            <p class="mt-2 text-xs opacity-70 break-words">{{ statusFor(packagePlugin).reason }}</p>
                        </div>
                        <UBadge :color="statusFor(packagePlugin).state === 'active' ? 'success' : statusFor(packagePlugin).state === 'needs-attention' ? 'warning' : 'neutral'" variant="subtle">
                            {{ statusFor(packagePlugin).label }}
                        </UBadge>
                    </div>
                    <details class="mt-2 text-xs opacity-75">
                        <summary class="cursor-pointer">Technical details</summary>
                        <dl class="mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                            <dt>Selected digest</dt><dd class="break-all">{{ packagePlugin.pointer?.current?.packageDigest ?? 'none' }}</dd>
                            <dt>Update digest</dt><dd class="break-all">{{ packagePlugin.pointer?.candidate?.packageDigest ?? 'none' }}</dd>
                            <dt>Package issues</dt><dd class="break-words">{{ packagePlugin.startup.issueCodes.join(', ') || 'none' }}</dd>
                        </dl>
                    </details>
                    <div class="mt-3 flex flex-wrap gap-2 border-t border-[var(--md-outline-variant)]/50 pt-3">
                        <UButton v-if="!packagePlugin.localAdmission && !packagePlugin.adminUpload && packagePlugin.display?.version && (!sitePolicyFor(packagePlugin.pluginId)?.catalogVisible || sitePolicyFor(packagePlugin.pluginId)?.approvedRelease.version !== packagePlugin.display.version)" size="xs" color="primary" :loading="siteCatalogBusy === packagePlugin.pluginId" @click="reviewSiteRelease(packagePlugin.pluginId, packagePlugin.display.version)">Review installed {{ packagePlugin.display.version }} for site catalog</UButton>
                        <UButton v-if="statusFor(packagePlugin).action === 'approve-site'" size="xs" color="primary" @click="focusSiteCatalog">Review site approval</UButton>
                        <UButton v-if="statusFor(packagePlugin).action === 'retry-check' && selectedWorkspaceId && chatWorkspaceId === selectedWorkspaceId" size="xs" color="neutral" variant="soft" :to="`/chat?dashboard=marketplace&page=installed&plugin=${encodeURIComponent(packagePlugin.pluginId)}&workspace=${encodeURIComponent(selectedWorkspaceId ?? '')}`">Open browser check</UButton>
                        <p v-else-if="statusFor(packagePlugin).action === 'retry-check'" class="w-full text-xs opacity-70">Select {{ workspaceContextName || selectedWorkspaceId }} in Chat, then run its browser check in Marketplace → Installed.</p>
                        <UButton v-if="statusFor(packagePlugin).action === 'configure' && selectedWorkspaceId && chatWorkspaceId === selectedWorkspaceId" size="xs" color="neutral" variant="soft" :to="`/chat?dashboard=marketplace&plugin=${encodeURIComponent(packagePlugin.pluginId)}&workspace=${encodeURIComponent(selectedWorkspaceId ?? '')}&setup=1`">Open workspace setup</UButton>
                        <p v-else-if="statusFor(packagePlugin).action === 'configure'" class="w-full text-xs opacity-70">Select {{ workspaceContextName || selectedWorkspaceId }} in Chat, then open this plugin’s Configure page.</p>
                        <UButton
                            v-if="packagePlugin.pointer?.current"
                            size="xs"
                            color="neutral"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="reviewV2Permissions(packagePlugin.pluginId, 'current')"
                        >
                            Review selected permissions
                        </UButton>
                        <UButton
                            v-if="packagePlugin.pointer?.candidate"
                            size="xs"
                            color="neutral"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="reviewV2Permissions(packagePlugin.pluginId, 'candidate')"
                        >
                            Review candidate permissions
                        </UButton>
                        <UButton
                            size="xs"
                            :disabled="!packagePlugin.pointer?.candidate || v2ActionLoading[packagePlugin.pluginId]"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="runV2Canary(packagePlugin.pluginId)"
                        >
                            Run canary
                        </UButton>
                        <UButton
                            v-if="packagePlugin.pointer?.candidate"
                            size="xs"
                            color="neutral"
                            :loading="developmentCanary.busyPluginId.value === packagePlugin.pluginId"
                            @click="developmentCanary.runBrowserCheck(packagePlugin.pluginId, selectedWorkspaceId || undefined).then(() => refreshPage())"
                        >
                            Run browser check
                        </UButton>
                        <p v-if="developmentCanary.notes.value[packagePlugin.pluginId]" class="w-full text-xs opacity-70">
                            {{ developmentCanary.notes.value[packagePlugin.pluginId] }}
                        </p>
                        <UButton
                            v-if="packagePlugin.localAdmission && packagePlugin.pointer?.candidate"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            @click="developmentCanary.exportCanaryReceipt(packagePlugin.pluginId, packagePlugin.pointer.candidate.packageDigest)"
                        >
                            Export verification receipt
                        </UButton>
                        <UButton
                            size="xs"
                            color="primary"
                            :disabled="!packagePlugin.pointer?.candidate || v2ActionLoading[packagePlugin.pluginId]"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="promoteV2Candidate(packagePlugin.pluginId, packagePlugin.pointer?.candidate?.packageDigest)"
                        >
                            Promote
                        </UButton>
                        <UButton
                            size="xs"
                            :disabled="!packagePlugin.pointer?.previous || v2ActionLoading[packagePlugin.pluginId]"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="rollbackV2Package(packagePlugin.pluginId)"
                        >
                            Roll back
                        </UButton>
                        <UButton
                            size="xs"
                            :color="enabledSet.has(packagePlugin.pluginId) ? 'neutral' : 'primary'"
                            :disabled="!packagePlugin.pointer?.current || toggleLoading[packagePlugin.pluginId]"
                            :loading="toggleLoading[packagePlugin.pluginId]"
                            @click="togglePlugin(packagePlugin.pluginId)"
                        >
                            {{ enabledSet.has(packagePlugin.pluginId) ? 'Deactivate workspace' : 'Activate workspace' }}
                        </UButton>
                        <UButton size="xs" color="neutral" variant="soft" :disabled="!packagePlugin.pointer?.current" @click="rolloutPluginId = rolloutPluginId === packagePlugin.pluginId ? null : packagePlugin.pluginId">
                            Enable or disable workspaces
                        </UButton>
                        <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            :disabled="v2ActionLoading[packagePlugin.pluginId]"
                            @click="uninstallV2Package(packagePlugin.pluginId)"
                        >
                            Uninstall package
                        </UButton>
                    </div>
                    <AdminPluginWorkspaceRollout v-if="rolloutPluginId === packagePlugin.pluginId" :plugin-id="packagePlugin.pluginId" :version="packagePlugin.display?.version ?? null" />
                </div>
            </div>
        </div>

        <details class="rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium">
                Advanced runtime diagnostics
            </summary>
            <div class="border-t border-[var(--md-outline-variant)] p-4">
                <AdminPluginRuntimeInspector />
            </div>
        </details>

        <AdminConfirmDialog
            v-model="showInstallTrustConfirm"
            title="Install plugin from source?"
            message="This plugin zip is application code. It will execute with OR3 server privileges once activated and is not sandboxed."
            confirm-text="Install anyway"
            important-note="Only install plugins you wrote or that you trust from a reviewed source."
            note-tone="warning"
            @confirm="confirmPluginFileInstall"
        />
    </div>
</template>

<script setup lang="ts">
import { ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminSession } from '~/composables/admin/useAdminData';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { requestWorkspacePluginReconcile } from '~/composables/plugins/bundled-v1-manager-runtime';
import {
    createDefaultAccessEditor,
    deserializeAccessEditor,
    withSerializedAccessPolicy,
    type AccessEditorState,
} from '~/utils/admin/plugin-access-policy';
import { useAdminWorkspaceGate } from '~/composables/admin/useAdminWorkspaceGate';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';
import PluginDevelopmentAdmission from '~/components/admin/PluginDevelopmentAdmission.vue';
import { useDevelopmentCanary } from '~/composables/admin/useDevelopmentCanary';
import { useRuntimeConfig } from '#imports';
import { usePortableActivations } from '~/composables/plugins/portable-client-runtime';
import { useTrustedV2Activations } from '~/composables/plugins/trusted-v2-manager';
import { pluginLifecycleView } from '~/composables/plugins/plugin-lifecycle-view';
import { describePluginStatus } from '~~/shared/plugins/lifecycle/lifecycle-view';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

type ManagedV2Package = {
    pluginId: string;
    pointer: {
        current: { packageDigest: string } | null;
        candidate: { packageDigest: string } | null;
        previous: { packageDigest: string } | null;
    } | null;
    workspaceEnabled: boolean;
    siteApproval?: 'approved' | 'required' | 'unknown';
    grantReview?: 'current' | 'required' | 'unknown';
    setup?: 'ready' | 'required' | 'blocked' | 'unknown';
    display?: {
        version: string | null;
        selectedDigest: string | null;
        candidateVersion: string | null;
        candidateDigest: string | null;
    };
    startup: {
        status: string;
        selectedSlot: string | null;
        selectedDigest: string | null;
        issueCodes: string[];
    };
    localAdmission?: {
        provenance: 'local-development';
        receiptSha256: string;
        admittedAt: string;
    } | null;
    adminUpload?: boolean;
};

const { selectedWorkspaceId, showWorkspaceSelector, onWorkspaceSelected } =
    useAdminWorkspaceGate(async () => {
        await refreshPage();
    });

const { data: session } = useAdminSession();
const {
    data: pageData,
    status,
    refresh: refreshPage,
} = useFetch<{
    plugins: ExtensionItem[];
    role?: string;
    canManageSitePlugins: boolean;
    workspaceId: string;
    workspaceName?: string;
    enabledPlugins: string[];
    packagePlugins: ManagedV2Package[];
}>('/api/admin/plugins-page', {
    query: computed(() => ({
        workspaceId: selectedWorkspaceId.value || undefined,
    })),
    credentials: 'include',
    server: false,
    immediate: false,
    dedupe: 'defer',
});
const isOwner = computed(() => pageData.value?.role === 'owner');
const canManageSitePlugins = computed(() => pageData.value?.canManageSitePlugins === true);
type SiteCatalogCard = { pluginId: string; name?: string; summary?: string; latestRelease?: { version?: string } | null };
type SiteCatalogPolicy = { pluginId: string; revision: number; catalogVisible: boolean; futureDefaultEnabled: boolean; approvedRelease: { version: string } };
const siteCatalogCards = ref<SiteCatalogCard[]>([]);
const siteCatalogPolicies = ref<SiteCatalogPolicy[]>([]);
const siteCatalogSearch = ref('');
const siteCatalogPage = ref(1);
const siteCatalogTotal = ref(0);
const siteCatalogLoaded = ref(false);
const siteCatalogConfigured = ref(false);
const siteCatalogLoading = ref(false);
const siteCatalogBusy = ref<string | null>(null);
const siteCatalogError = ref<string | null>(null);
const sitePolicyFor = (pluginId: string) => siteCatalogPolicies.value.find((policy) => policy.pluginId === pluginId);
async function loadSiteCatalog() {
    if (!canManageSitePlugins.value || siteCatalogLoading.value) return;
    siteCatalogLoading.value = true;
    siteCatalogError.value = null;
    try {
        const result = await $fetch<{ configured: boolean; catalog: { items?: SiteCatalogCard[]; total?: number } | null; policies: SiteCatalogPolicy[] }>('/api/admin/plugins/site-catalog', {
            query: { search: siteCatalogSearch.value.trim(), page: siteCatalogPage.value, pageSize: 24 },
        });
        siteCatalogConfigured.value = result.configured;
        siteCatalogCards.value = result.catalog?.items ?? [];
        siteCatalogTotal.value = result.catalog?.total ?? 0;
        siteCatalogPolicies.value = result.policies;
        siteCatalogLoaded.value = true;
    } catch (error) {
        siteCatalogError.value = parseErrorMessage(error, 'Could not load site catalog');
    } finally {
        siteCatalogLoading.value = false;
    }
}
function searchSiteCatalog() { siteCatalogPage.value = 1; void loadSiteCatalog(); }
function changeSiteCatalogPage(delta: number) { siteCatalogPage.value += delta; void loadSiteCatalog(); }
watch(canManageSitePlugins, (allowed) => { if (allowed) void loadSiteCatalog(); }, { immediate: true });
async function reviewSiteRelease(pluginId: string, version?: string) {
    if (!version || siteCatalogBusy.value) return;
    siteCatalogBusy.value = pluginId;
    try {
        const preview = await $fetch<{
            releaseId: string; packageTreeSha256: string; authoritySha256: string;
            requestedGrants: string[]; authority: { trust?: string; destinations?: unknown[]; dataScopes?: string[]; connectionScopes?: string[]; writes?: string[] } | null;
            current: { revision: number } | null;
        }>(`/api/admin/plugins/site-catalog/${encodeURIComponent(pluginId)}`, { query: { version } });
        const access = [
            `Trust: ${preview.authority?.trust ?? 'unknown'}`,
            `Grants: ${preview.requestedGrants.join(', ') || 'none'}`,
            `Destinations: ${preview.authority?.destinations?.length ?? 0}`,
            `Data scopes: ${preview.authority?.dataScopes?.join(', ') || 'none'}`,
            `Connection scopes: ${preview.authority?.connectionScopes?.join(', ') || 'none'}`,
            `Writes: ${preview.authority?.writes?.join(', ') || 'none'}`,
        ].join('\n');
        const clearsFutureDefault = sitePolicyFor(pluginId)?.futureDefaultEnabled &&
            sitePolicyFor(pluginId)?.approvedRelease.version !== version;
        const accepted = await confirm({
            title: `Approve ${pluginId} ${version} for this site?`,
            message: `${access}\n\nThis makes the release visible to workspace users. Workspace permission review and setup remain required.${clearsFutureDefault ? '\n\nThe current new-workspace default will pause until you review this version and enable the default again.' : ''}`,
            importantNote: `Exact package: ${preview.packageTreeSha256}`,
            confirmText: 'Approve for site',
        });
        if (!accepted) return;
        await $fetch('/api/admin/plugins/site-catalog', {
            method: 'POST', headers: ADMIN_HEADERS,
            body: { pluginId, action: 'approve', expectedRevision: preview.current?.revision ?? 0, version,
                expectedReleaseId: preview.releaseId, expectedPackageTreeSha256: preview.packageTreeSha256, expectedAuthoritySha256: preview.authoritySha256 },
        });
        await Promise.all([loadSiteCatalog(), refreshPage()]);
    } catch (error) {
        toast.add({ title: 'Site approval failed', description: parseErrorMessage(error, 'Review the release again.'), color: 'error' });
    } finally {
        siteCatalogBusy.value = null;
    }
}
async function hideSiteRelease(pluginId: string) {
    const policy = sitePolicyFor(pluginId);
    if (!policy || siteCatalogBusy.value) return;
    const accepted = await confirm({
        title: `Remove ${pluginId} from the site catalog?`,
        message: 'New discovery and enablement will stop. Workspaces already using the plugin keep running until you disable them separately.',
        confirmText: 'Remove from catalog',
    });
    if (!accepted) return;
    siteCatalogBusy.value = pluginId;
    try {
        await $fetch('/api/admin/plugins/site-catalog', { method: 'POST', headers: ADMIN_HEADERS,
            body: { pluginId, action: 'hide', expectedRevision: policy.revision } });
        await Promise.all([loadSiteCatalog(), refreshPage()]);
    } catch (error) {
        toast.add({ title: 'Could not change site approval', description: parseErrorMessage(error, 'Refresh and try again.'), color: 'error' });
    } finally {
        siteCatalogBusy.value = null;
    }
}
const { selectedWorkspace } = useAdminWorkspaceContext();
const workspaceContextName = computed(
    () => selectedWorkspace.value?.name || pageData.value?.workspaceName
);

// 4. Extension Management
const { fileInput, triggerFileInput, install, installFromUrl, uninstall } = useExtensionManagement(
    canManageSitePlugins
);
const runtimeConfig = useRuntimeConfig();
const publicAdminConfig = (runtimeConfig.public as {
    admin?: {
        pluginZipInstallEnabled?: boolean;
        allowRebuild?: boolean;
    };
}).admin ?? {};
const extensionInstallEnabled = publicAdminConfig.pluginZipInstallEnabled !== false;
const rebuildAvailable = publicAdminConfig.allowRebuild === true;
const extensionInstallDisabled = !extensionInstallEnabled;

// URL import state
const showUrlModal = ref(false);
const urlInstalling = ref(false);
const fileInstalling = ref(false);
const showInstallTrustConfirm = ref(false);
const toast = useToast();
const rebuildRequired = ref(false);

function requestPluginFileInstall() {
    if (!canManageSitePlugins.value) return;
    const file = fileInput.value?.files?.[0];
    if (!file) return;
    showInstallTrustConfirm.value = true;
}

watch(showInstallTrustConfirm, (open) => {
    if (!open && fileInput.value) fileInput.value.value = '';
});

function confirmPluginFileInstall() {
    showInstallTrustConfirm.value = false;
    void installPlugin();
}

async function installPluginFromUrl(url: string) {
    if (!canManageSitePlugins.value) return;
    urlInstalling.value = true;
    try {
        const installed = await installFromUrl(
            'plugin',
            url,
            refresh,
            selectedWorkspaceId.value || undefined
        );
        if (!installed) return;
        showUrlModal.value = false;
        if ('kind' in installed && installed.kind === 'v2-candidate') {
            toast.add({
                title: 'V2 candidate prepared',
                description: `Digest ${installed.packageDigest} is inactive. ${installed.grantReviewRequired ? 'Review permissions, then run' : 'Run'} its canary, promote it, then activate it for this workspace.`,
                color: 'info',
            });
            return;
        }
        rebuildRequired.value = true;
        toast.add({
            title: 'Plugin installed',
            description:
                'The plugin has been installed from URL. Rebuild + Restart is required before new client runtime modules can load in production.',
            color: 'info',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install plugin from URL');
        toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
        urlInstalling.value = false;
    }
}
const configuredPluginModules =
    (runtimeConfig.public as {
        or3?: { plugins?: { modules?: string[] } };
    }).or3?.plugins?.modules ?? [];

// Computed & State
const pending = computed(() => status.value === 'pending');
const plugins = computed(
    () => pageData.value?.plugins ?? []
);
const v2Packages = computed(() => pageData.value?.packagePlugins ?? []);
const chatWorkspaceId = computed(() => getCachedSessionContext()?.workspace?.id ?? null);
function focusSiteCatalog() {
    document.getElementById('site-plugin-catalog')?.scrollIntoView({ behavior: 'smooth' });
    (document.querySelector('#site-plugin-catalog input') as HTMLInputElement | null)?.focus();
}
const rolloutPluginId = ref<string | null>(null);
const route = useRoute();
watch([v2Packages, () => route.query.plugin], ([packages, plugin]) => {
    if (typeof plugin === 'string' && packages.some((entry) => entry.pluginId === plugin)) rolloutPluginId.value = plugin;
}, { immediate: true });
const portableActivations = usePortableActivations();
const trustedV2Activations = useTrustedV2Activations();
function statusFor(entry: ManagedV2Package) {
    return describePluginStatus(
        pluginLifecycleView(entry, selectedWorkspaceId.value || null, portableActivations, trustedV2Activations),
        {
            enabled: enabledSet.value.has(entry.pluginId),
            siteApproval: entry.siteApproval ?? 'unknown',
            grantReview: entry.grantReview ?? 'unknown',
            setup: entry.setup ?? 'unknown',
            packageReady: entry.startup.status === 'ready',
        }
    );
}
const developmentCanary = useDevelopmentCanary();

const enabledSet = ref<Set<string>>(new Set());
const settingsByPlugin = reactive<Record<string, string>>({});
const accessByPlugin = reactive<
    Record<
        string,
        AccessEditorState
    >
>({});
const toggleLoading = reactive<Record<string, boolean>>({});
const v2ActionLoading = reactive<Record<string, boolean>>({});
const { confirm } = useConfirmDialog();

function getAccessEditor(pluginId: string) {
    if (!accessByPlugin[pluginId]) {
        accessByPlugin[pluginId] = createDefaultAccessEditor();
    }
    return accessByPlugin[pluginId]!;
}

// Watcher
watch(() => pageData.value, (val) => {
    if (val?.enabledPlugins) {
        enabledSet.value = new Set(val.enabledPlugins);
    }
}, { immediate: true });

watch(
    [() => session.value?.kind, selectedWorkspaceId],
    ([kind, workspaceId]) => {
        if (
            kind === 'workspace_admin' ||
            (kind === 'super_admin' && workspaceId)
        ) {
            void refreshPage();
        }
    },
    { immediate: true }
);

// Actions
async function setEnabled(pluginId: string, enabled: boolean) {
    const res = await $fetch<{ ok: boolean; enabled: string[] }>(
        '/api/admin/plugins/workspace-enable',
        {
            method: 'POST',
            body: {
                pluginId,
                enabled,
                workspaceId: selectedWorkspaceId.value,
            },
            headers: ADMIN_HEADERS,
        }
    );
    enabledSet.value = new Set(res.enabled);
    requestWorkspacePluginReconcile('local-admin-change');
}

async function togglePlugin(pluginId: string) {
    if (toggleLoading[pluginId]) return;
    toggleLoading[pluginId] = true;
    try {
        await setEnabled(pluginId, !enabledSet.value.has(pluginId));
    } finally {
        toggleLoading[pluginId] = false;
    }
}

async function installPlugin() {
    if (!canManageSitePlugins.value || fileInstalling.value) return;
    fileInstalling.value = true;
    try {
        const installed = await install(
            'plugin',
            refresh,
            selectedWorkspaceId.value || undefined
        );
        if (!installed) return;
        if ('kind' in installed && installed.kind === 'v2-candidate') {
            toast.add({
                title: 'V2 candidate prepared',
                description: `Digest ${installed.packageDigest} is inactive. ${installed.grantReviewRequired ? 'Review permissions, then run' : 'Run'} its canary, promote it, then activate it for this workspace.`,
                color: 'info',
            });
            return;
        }
        rebuildRequired.value = true;
        toast.add({
            title: 'Plugin installed',
            description:
                'The plugin has been installed. Rebuild + Restart is required before new client runtime modules can load in production.',
            color: 'info',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install plugin');
        toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
        fileInstalling.value = false;
        if (fileInput.value) fileInput.value.value = '';
    }
}

async function uninstallPlugin(pluginId: string) {
    if (!canManageSitePlugins.value) return;
    await uninstall(pluginId, 'plugin', refresh);
}

async function runV2PackageAction(
    pluginId: string,
    action: 'canary' | 'promote' | 'rollback' | 'uninstall',
    body: Record<string, unknown> = {}
) {
    if (!canManageSitePlugins.value || v2ActionLoading[pluginId]) return;
    v2ActionLoading[pluginId] = true;
    try {
        const result = await $fetch<{ ok: boolean; code?: string }>(
            `/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/${action}`,
            {
                method: 'POST',
                body: {
                    workspaceId: selectedWorkspaceId.value,
                    ...body,
                },
                headers: ADMIN_HEADERS,
            }
        );
        if (!result.ok) {
            throw new Error(result.code ?? `V2 package ${action} was blocked`);
        }
        await refresh();
        requestWorkspacePluginReconcile('manifest-revision-change');
        toast.add({
            title: `V2 package ${action} complete`,
            color: 'success',
        });
    } catch (error: unknown) {
        toast.add({
            title: 'V2 package action failed',
            description: parseErrorMessage(error, `Failed to ${action} V2 package`),
            color: 'error',
        });
    } finally {
        v2ActionLoading[pluginId] = false;
    }
}

async function runV2Canary(pluginId: string) {
    await runV2PackageAction(pluginId, 'canary');
}

async function reviewV2Permissions(pluginId: string, target: 'current' | 'candidate') {
    if (!canManageSitePlugins.value || v2ActionLoading[pluginId]) return;
    v2ActionLoading[pluginId] = true;
    try {
        const review = await $fetch<{
            packageDigest: string;
            authoritySha256: string;
            requestedGrants: string[];
            reviewStatus: string;
            version: string;
        }>(`/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/review`, {
            query: { workspaceId: selectedWorkspaceId.value, target },
        });
        if (review.reviewStatus === 'current') {
            toast.add({ title: 'Permissions already reviewed', color: 'info' });
            return;
        }
        const approved = await confirm({
            title: `Review ${pluginId} ${target === 'current' ? 'selected release' : 'candidate'} permissions`,
            message: review.requestedGrants.length
                ? `Approve these requested permissions for this workspace: ${review.requestedGrants.join(', ')}?`
                : 'Approve this package authority for this workspace?',
            importantNote: `Package: ${review.packageDigest}. Authority: ${review.authoritySha256}. Trusted-host code runs in the host page.`,
            noteTone: 'warning',
            confirmText: 'Approve permissions',
        });
        if (!approved) return;
        await $fetch(`/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/grants`, {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: {
                workspaceId: selectedWorkspaceId.value,
                approvedGrants: review.requestedGrants,
                expectedPackageDigest: review.packageDigest,
                expectedAuthoritySha256: review.authoritySha256,
                version: review.version,
                target,
            },
        });
        await refreshPage();
        toast.add({ title: 'Package permissions approved', color: 'success' });
    } catch (error: unknown) {
        toast.add({
            title: 'Permission review failed',
            description: parseErrorMessage(error, 'Could not review package permissions'),
            color: 'error',
        });
    } finally {
        v2ActionLoading[pluginId] = false;
    }
}

async function promoteV2Candidate(pluginId: string, candidateDigest?: string) {
    if (!candidateDigest) return;
    await runV2PackageAction(pluginId, 'promote', { candidateDigest });
}

async function rollbackV2Package(pluginId: string) {
    if (!canManageSitePlugins.value || v2ActionLoading[pluginId]) return;
    v2ActionLoading[pluginId] = true;
    try {
        const review = await $fetch<{
            ok: boolean; currentVersion: string; previousVersion: string;
            currentDigest: string; previousDigest: string; pointerRevision: number;
            enabledWorkspaces: number; enabledWorkspaceSha256: string;
            blocking: { workspaceId: string; code: string }[];
        }>(`/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/rollback-review`);
        if (!review.ok) throw new Error(`Rollback is blocked in ${review.blocking.length} workspace(s): ${review.blocking.slice(0, 3).map((item) => `${item.workspaceId} (${item.code})`).join(', ')}.`);
        const approved = await confirm({
            title: `Restore ${pluginId} ${review.previousVersion}?`,
            message: `This restores the shared selected code from ${review.currentVersion} to ${review.previousVersion} for ${review.enabledWorkspaces} enabled workspace(s). Saved data and workspace choices remain.`,
            importantNote: `Previous package: ${review.previousDigest}. The server rechecks every enabled workspace before changing selection.`,
            noteTone: 'warning', confirmText: 'Restore previous version',
        });
        if (!approved) return;
        await $fetch(`/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/rollback`, {
            method: 'POST', headers: ADMIN_HEADERS,
            body: { workspaceId: selectedWorkspaceId.value, expectedCurrentDigest: review.currentDigest,
                expectedPreviousDigest: review.previousDigest, expectedPointerRevision: review.pointerRevision,
                expectedEnabledWorkspaceSha256: review.enabledWorkspaceSha256 },
        });
        await refresh();
        requestWorkspacePluginReconcile('manifest-revision-change');
        toast.add({ title: 'Previous version restored', color: 'success' });
    } catch (error) {
        toast.add({ title: 'Rollback was refused', description: parseErrorMessage(error, 'Review rollback again.'), color: 'error' });
    } finally { v2ActionLoading[pluginId] = false; }
}

async function uninstallV2Package(pluginId: string) {
    const confirmed = await confirm({
        title: 'Uninstall V2 package',
        message: `Remove the global V2 package pointer for "${pluginId}"? Package bytes and workspace data are retained.`,
        danger: true,
        confirmText: 'Uninstall package',
    });
    if (!confirmed) return;
    await runV2PackageAction(pluginId, 'uninstall');
}

async function loadSettings(pluginId: string) {
    if (settingsByPlugin[pluginId]) return;
    const res = await $fetch<{
        settings: Record<string, unknown>;
        effectiveAccessPolicy?: {
            authRequired?: boolean;
            requiredEntitlements?: string[];
            requiredWorkspaceRoles?: string[];
        };
    }>(
        '/api/admin/plugins/workspace-settings',
        {
            query: {
                pluginId,
                workspaceId: selectedWorkspaceId.value,
            },
        }
    );
    settingsByPlugin[pluginId] = JSON.stringify(res.settings ?? {}, null, 2);
    accessByPlugin[pluginId] = deserializeAccessEditor(
        res.effectiveAccessPolicy
    );
}

async function saveSettings(pluginId: string) {
    if (!isOwner.value) return;
    const raw = settingsByPlugin[pluginId] || '{}';
    let parsed: Record<string, unknown> = {};
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        toast.add({
            title: 'Invalid JSON',
            description: 'Settings must be valid JSON.',
            color: 'error',
        });
        return;
    }
    
    try {
        const accessEditor = getAccessEditor(pluginId);
        await $fetch('/api/admin/plugins/workspace-settings', {
            method: 'POST',
            body: {
                pluginId,
                settings: withSerializedAccessPolicy(parsed, accessEditor),
                workspaceId: selectedWorkspaceId.value,
            },
            headers: ADMIN_HEADERS,
        });
        requestWorkspacePluginReconcile('manifest-revision-change');
        toast.add({
            title: 'Settings saved',
            description: 'Plugin configuration has been updated.',
            color: 'success',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to save settings');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}

async function refresh() {
    await refreshPage();
}
</script>
