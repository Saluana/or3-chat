import { computed, defineComponent, onMounted, ref, type Component, type Ref } from 'vue';
import { useNuxtApp, useRuntimeConfig, useToast } from '#imports';
import UAlert from '@nuxt/ui/components/Alert.vue';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCheckbox from '@nuxt/ui/components/Checkbox.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import UPopover from '@nuxt/ui/components/Popover.vue';
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue';
import UTooltip from '@nuxt/ui/components/Tooltip.vue';
import ChatComposerShell from '~/components/chat/ChatComposerShell.vue';
import ChatMessage from '~/components/chat/ChatMessage.vue';
import SidebarEmptyState from '~/components/sidebar/SidebarEmptyState.vue';
import SidebarGroupHeader from '~/components/sidebar/SidebarGroupHeader.vue';
import { useChatInputTheme } from '~/composables/chat/useChatInputTheme';
import { setActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { useIcon } from '~/composables/useIcon';
import { useOr3Config } from '~/composables/useOr3Config';
import { getActiveWorkspaceId, getDefaultDb, getWorkspaceDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
import { registerWorkspaceProfile } from '~/core/workspace-profiles/registry';
import { Or3Scroll } from 'or3-scroll';
import { createExternalAgentStagingBridge } from './external-agent-staging-bridge';

const ClientOnly = defineComponent({
    setup(_props, { slots }) {
        const mounted = ref(false);
        onMounted(() => { mounted.value = true; });
        return () => mounted.value ? slots.default?.() : slots.fallback?.();
    },
});

const CONNECTIONS_KEY = 'external-agents.connections.v1';
const VAULT_KEY = 'or3.external-agents.credentials.v1';
function workspaceDb(workspaceId: string) {
    if (!workspaceId) throw new Error('External Agent workspace is required');
    if (workspaceId !== (getActiveWorkspaceId() || 'local')) {
        throw new Error('External Agent workspace is outside its grant');
    }
    return workspaceId === 'local' ? getDefaultDb() : getWorkspaceDb(workspaceId);
}

function assertConnectionsKey(key: string): void {
    if (key !== CONNECTIONS_KEY) throw new Error('External Agent KV key is outside its grant');
}

function assertVaultKey(key: string): void {
    if (key !== VAULT_KEY) throw new Error('External Agent vault key is outside its grant');
}

function approvedHostUrl(value: string, allowQuery = false): URL {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/gu, '');
    const loopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        url.username || url.password || (!allowQuery && (url.search || url.hash)) || url.hash) {
        throw new Error('External Agent host URL is not trusted');
    }
    return url;
}

function containsHostRequest(baseUrl: URL, request: URL): boolean {
    const path = baseUrl.pathname.replace(/\/$/u, '');
    return request.origin === baseUrl.origin &&
        (request.pathname === path || request.pathname.startsWith(`${path}/`));
}

/** Host-owned, restricted capabilities for the separately built External Agents package. */
export function createExternalAgentHostBridge() {
    const nuxtApp = useNuxtApp();
    const runtimeConfig = useRuntimeConfig();
    const config = useOr3Config();
    const toast = useToast();
    const workspaceId = getActiveWorkspaceId() || 'local';
    const verifying = new Map<symbol, URL>();
    const theme = nuxtApp.$theme as {
        activeTheme: Ref<string>;
        activeComponents: Ref<Record<string, Component>>;
    };
    const requirePanes = () => {
        const api = getGlobalMultiPaneApi();
        if (!api) throw new Error('Workspace pane host is unavailable');
        return api;
    };
    return {
        beginHostVerification(baseUrl: string) {
            const origin = approvedHostUrl(baseUrl);
            const token = Symbol('agent-host-verification');
            verifying.set(token, origin);
            return () => { verifying.delete(token); };
        },
        async authorizeDestination(url: string, destination: string): Promise<boolean> {
            if ((getActiveWorkspaceId() || 'local') !== workspaceId) return false;
            let request: URL;
            try {
                request = approvedHostUrl(url, true);
            } catch {
                return false;
            }
            if (request.origin !== destination) return false;
            if ([...verifying.values()].some((base) => containsHostRequest(base, request))) return true;
            const raw = (await getKvByName(CONNECTIONS_KEY, workspaceDb(workspaceId)))?.value;
            if (typeof raw !== 'string') return false;
            try {
                const stored = JSON.parse(raw) as { hosts?: Array<{ baseUrl?: unknown }> };
                return Array.isArray(stored.hosts) && stored.hosts.some((host) => {
                    if (typeof host.baseUrl !== 'string') return false;
                    try { return containsHostRequest(approvedHostUrl(host.baseUrl), request); }
                    catch { return false; }
                });
            } catch {
                return false;
            }
        },
        staging: createExternalAgentStagingBridge(),
        registerCodingProfile(profile: unknown) {
            if (!profile || typeof profile !== 'object' ||
                (profile as { id?: unknown }).id !== 'coding-workspace') {
                throw new Error('External Agent profile id is outside its grant');
            }
            return registerWorkspaceProfile(profile, { source: { kind: 'plugin', id: 'or3-external-agents' } });
        },
        ui: {
            components: {
                chatComposerShell: ChatComposerShell,
                chatMessage: computed(() => theme.activeComponents.value['chat-message'] ?? ChatMessage),
                scroll: Or3Scroll,
                ClientOnly, SidebarEmptyState, SidebarGroupHeader,
                UAlert, UBadge, UButton, UCheckbox, UIcon, UInput,
                UModal, UPopover, USelectMenu, UTooltip,
            },
            connect: {
                enabled: runtimeConfig.public.ssrAuthEnabled === true && runtimeConfig.public.connect.enabled === true,
                publicUrl: runtimeConfig.public.connect.publicUrl,
                removeEnvironment(environmentId: string) {
                    return globalThis.fetch('/api/connect/environments/remove', {
                        method: 'POST',
                        credentials: 'include',
                        cache: 'no-store',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Or3-Connect-Intent': 'remove',
                        },
                        body: JSON.stringify({ environmentId }),
                    });
                },
            },
            limits: {
                maxFilesPerMessage: config.limits.maxFilesPerMessage,
                maxFileSizeBytes: config.limits.maxFileSizeBytes,
            },
            activeTheme: theme.activeTheme,
            icon: (token: string) => useIcon(token as Parameters<typeof useIcon>[0]),
            chatInputTheme: useChatInputTheme,
            toast: (input: { title: string; description?: string; color?: string }) =>
                toast.add(input as Parameters<typeof toast.add>[0]),
            setActiveSidebarPage,
            closeSidebarIfMobile,
            panes: {
                get items() { return requirePanes().panes; },
                get activeIndex() { return requirePanes().activePaneIndex; },
                set: (index: number, appId: string, recordId: string) =>
                    requirePanes().setPaneApp(index, appId, { recordId }),
                open: (appId: string, recordId: string) =>
                    requirePanes().newPaneForApp(appId, { initialRecordId: recordId }),
                clearAgentPanes() {
                    const api = getGlobalMultiPaneApi();
                    if (!api) return;
                    api.panes.value.forEach((pane, index) => {
                        if (pane.mode !== 'or3-external-agent') return;
                        api.updatePane(index, {
                            mode: 'chat', threadId: '', documentId: undefined,
                            pendingThreadId: undefined, messages: [], validating: false,
                        });
                    });
                },
            },
        },
        workspaceKv: {
            async get(workspaceId: string, key: string) {
                assertConnectionsKey(key);
                return (await getKvByName(key, workspaceDb(workspaceId)))?.value ?? null;
            },
            async set(workspaceId: string, key: string, value: string) {
                assertConnectionsKey(key);
                await setKvByName(key, value, workspaceDb(workspaceId));
            },
        },
        vaultStorage: typeof globalThis.localStorage === 'undefined' ? null : {
            getItem(key: string) {
                assertVaultKey(key);
                return globalThis.localStorage.getItem(key);
            },
            setItem(key: string, value: string) {
                assertVaultKey(key);
                globalThis.localStorage.setItem(key, value);
            },
            removeItem(key: string) {
                assertVaultKey(key);
                globalThis.localStorage.removeItem(key);
            },
        },
    };
}
