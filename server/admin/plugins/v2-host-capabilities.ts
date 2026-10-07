import { TRUSTED_PLUGIN_GRANT_DESCRIPTIONS } from '../../../shared/plugins/grant-description';
import type { PluginV2HostCapabilities } from '../../../shared/plugins/v2-compatibility';
import {
    PORTABLE_PROFILE_NAME,
    QUALIFIED_BROWSER_ENGINES,
} from '../../../shared/plugins/isolation/portable-bootstrap';
import { REMOTE_CAPABILITY_METHODS } from '../../../shared/plugins/isolation/capability-bridge';
import { SDK_LOGIC_RPC_METHODS } from '~~/shared/plugins/isolation/host-rpc-broker';
import { UI_CONTRIBUTE_EVENT } from '~~/shared/plugins/isolation/worker-runtime';

export type Or3PluginV2GrantRegistration =
    | {
          readonly kind: 'rpc';
          readonly methods: readonly string[];
      }
    | {
          readonly kind: 'event';
          readonly event: string;
          readonly slot: 'dashboard' | 'command-palette';
      }
    | {
          readonly kind: 'test';
          /** Stable test id for a host route/action qualification. */
          readonly id: string;
      }
    | {
          readonly kind: 'adapter';
          readonly module: string;
          readonly exportName: string;
      };

/**
 * One source of truth for grants the host advertises to V2 packages. Every
 * entry names the concrete mediated host surface and records whether that
 * surface has passed this host's qualification. Keeping the registry next to
 * the compatibility contract prevents a grant from becoming installable just
 * because a string was added to an array.
 */
export interface Or3PluginV2GrantQualification {
    readonly grant: string;
    readonly reviewDescription?: string;
    readonly status: 'qualified' | 'unqualified';
    /** The callable method/event or qualification test that substantiates it. */
    readonly registration: Or3PluginV2GrantRegistration;
    /**
     * Trust modes that may request this grant. Omitted qualified grants stay
     * available to trusted-host and isolated-client.
     */
    readonly trustModes?: readonly ('trusted-host' | 'isolated-client' | 'isolated-server')[];
}

function sdkMethodsForGrant(grant: string): readonly string[] {
    return Object.entries(SDK_LOGIC_RPC_METHODS)
        .filter(([, methodGrant]) => methodGrant === grant)
        .map(([method]) => method);
}

export const OR3_PLUGIN_V2_GRANT_REGISTRY: readonly Or3PluginV2GrantQualification[] =
    Object.freeze([
        { grant: 'chat.tool.card',
            status: 'unqualified',
            trustModes: ['isolated-client'],
            registration: {
                kind: 'adapter',
                module: 'app/components/chat/tool-cards/ToolCardFrameHost.vue',
                exportName: 'default',
            },
            reviewDescription:
                TRUSTED_PLUGIN_GRANT_DESCRIPTIONS['chat.tool.card'],
        },
        {
            grant: 'chat.tool.card.embed',
            status: 'unqualified',
            trustModes: ['isolated-client'],
            registration: {
                kind: 'adapter',
                module: 'shared/plugins/isolation/contained-view-policy.ts',
                exportName: 'containedViewCsp',
            },
            reviewDescription:
                TRUSTED_PLUGIN_GRANT_DESCRIPTIONS['chat.tool.card.embed'],
        },
        { grant: 'tools.register.client', status: 'qualified', registration: {kind: 'test', id: 'portable-tools.workspace-grant-and-teardown'} },
        {
            grant: 'ui.dashboard.register',
            status: 'qualified',
            registration: {
                kind: 'event',
                event: UI_CONTRIBUTE_EVENT,
                slot: 'dashboard',
            },
        },
        {
            grant: 'ui.command-palette.register',
            status: 'qualified',
            registration: {
                kind: 'event',
                event: UI_CONTRIBUTE_EVENT,
                slot: 'command-palette',
            },
        },
        {
            grant: 'settings.read',
            status: 'qualified',
            registration: {
                kind: 'rpc',
                methods: sdkMethodsForGrant('settings.read'),
            },
        },
        {
            grant: 'settings.write',
            status: 'qualified',
            registration: {
                kind: 'rpc',
                methods: sdkMethodsForGrant('settings.write'),
            },
        },
        {
            grant: 'storage.read',
            status: 'qualified',
            registration: {
                kind: 'rpc',
                methods: sdkMethodsForGrant('storage.read'),
            },
        },
        {
            grant: 'storage.write',
            status: 'qualified',
            registration: {
                kind: 'rpc',
                methods: sdkMethodsForGrant('storage.write'),
            },
        },
        {
            grant: 'network.http',
            status: 'qualified',
            registration: {
                kind: 'rpc',
                methods: [
                    REMOTE_CAPABILITY_METHODS.aiModels,
                    REMOTE_CAPABILITY_METHODS.aiComplete,
                    REMOTE_CAPABILITY_METHODS.connectionsDispatch,
                ],
            },
        },
        {
            grant: 'documents.read',
            status: 'qualified',
            registration: {
                kind: 'test',
                id: 'first-action.post.documents-read-approved',
            },
        },
        {
            grant: 'documents.write',
            status: 'qualified',
            registration: {
                kind: 'test',
                id: 'usePortableHostActions.document-write',
            },
        },
        ...Object.entries({
            'ui.sidebar.register': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'ui.pane.register': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'ui.toast': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'ui.workspace-profile.register': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'ai.provider': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'ai.models': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'tools.use': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'jobs.background': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'hooks.emit': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'chat.read': ['app/composables/plugins/trusted-records.ts', 'createTrustedRecords'],
            'chat.message.write': ['app/composables/plugins/trusted-records.ts', 'createTrustedRecords'],
            'workspace.connections.read': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'workspace.connections.manage': ['app/composables/plugins/trusted-runtime-services.ts', 'createTrustedRuntimeServices'],
            'panes.open': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'workspace.read': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'hooks.register': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'commands.register': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'activity.register': ['app/composables/plugins/trusted-host-context.ts', 'createTrustedHostContext'],
            'chat.tool.card': [
                'app/composables/chat/tool-cards.ts',
                'registerToolCardBinding',
            ],
            'chat.message.renderer': ['app/composables/chat/message-renderers.ts', 'registerMessageRenderer'],
            'chat.editor.extension': ['app/composables/plugins/trusted-editor.ts', 'registerTrustedEditorExtension'],
            'tools.model.register': ['app/composables/plugins/trusted-models.ts', 'registerTrustedExecutionModel'],
            'network.stream': ['app/composables/plugins/trusted-mediation.ts', 'createTrustedMediation'],
            'secrets.read': ['app/composables/plugins/trusted-production-stores.ts', 'createLocalStorageSecretStore'],
            'secrets.write': ['app/composables/plugins/trusted-production-stores.ts', 'createLocalStorageSecretStore'],
            'secrets.use': ['app/composables/plugins/trusted-production-stores.ts', 'createLocalStorageSecretStore'],
            'files.pick': ['app/composables/plugins/trusted-production-stores.ts', 'createWorkspaceFileStore'],
            'files.read': ['app/composables/plugins/trusted-production-stores.ts', 'createWorkspaceFileStore'],
            'files.write': ['app/composables/plugins/trusted-production-stores.ts', 'createWorkspaceFileStore'],
            'posts.read': ['app/composables/plugins/trusted-production-stores.ts', 'createWorkspacePostStore'],
            'posts.write': ['app/composables/plugins/trusted-production-stores.ts', 'createWorkspacePostStore'],
        } as const satisfies Record<string, readonly [string, string]>).map(([grant, [module, exportName]]) => ({
            grant,
            reviewDescription: TRUSTED_PLUGIN_GRANT_DESCRIPTIONS[grant],
            status: 'qualified' as const,
            trustModes: ['trusted-host'] as const,
            registration: { kind: 'adapter' as const, module, exportName },
        })),
        // Contract inventory only. These grants are deliberately unqualified
        // until a production adapter and conformance fixture exist.
        ...[
            'ui.card.register',
            'ui.action.register',
            'ui.confirm',
            'ui.progress',
            'commands.run.public',
            'chat.create',
            'workspace.switch',
            'events.register',
            'ai.complete',
        ].map((grant) => ({
            grant,
            status: 'unqualified' as const,
            registration: { kind: 'test' as const, id: `proposed.${grant}` },
        })),
    ]);

const qualifiedGrants = OR3_PLUGIN_V2_GRANT_REGISTRY
    .filter((entry) => entry.status === 'qualified')
    .map((entry) => entry.grant);

const grantTrustModes = Object.fromEntries(
    OR3_PLUGIN_V2_GRANT_REGISTRY
        .flatMap((entry) =>
            entry.status === 'qualified' && entry.trustModes
                ? [[entry.grant, entry.trustModes] as const]
                : []
        )
);

/** The first public V2 host contract. Keep it independent from app package
 * releases so package compatibility follows the documented plugin ABI.
 *
 * `isolated-client` is declared because the host now runs contained portable
 * clients: the entry bytes are served digest-addressed, verified in the browser,
 * and executed inside the opaque-origin sandbox. Reviewed `trusted-host` client
 * packages run in the host page when the V2 loader and browser runtime are enabled.
 * Only grants the host actually honors appear here —
 * a package requesting anything else is refused rather than trusted.
 *
 * `documents.read` is honored by the host-mediated selection handoff: the server
 * refuses to mint a selection handle for a release that requests it without an
 * approved review, and the host page re-checks the live activation before any
 * content is passed in. `documents.write` is honored by the host action executor,
 * which performs the write itself and re-checks the grant at prepare and execute
 * time. `storage.read`/`storage.write` are honored by the portable runtime's
 * plugin-namespaced KV store (prefix-scoped, value-size-capped), and the SDK
 * gateways guard get/list and set/delete with the server-authored grants.
 * None of these grants reaches publisher code as a raw host capability. */
export const OR3_PLUGIN_V2_HOST_CAPABILITIES: PluginV2HostCapabilities = Object.freeze({
    or3Version: '0.3.0',
    pluginApiVersion: '2.1.0',
    supportedTrustModes: Object.freeze(['trusted-host', 'isolated-client'] as const),
    supportedGrants: Object.freeze(qualifiedGrants),
    grantTrustModes: Object.freeze(grantTrustModes),
    supportedFeatures: Object.freeze(['or3-portable-client-v1', 'or3-portable-workspace-v1', 'or3-trusted-ui-kit-v1', 'or3-trusted-host-v2', 'or3-trusted-chat-records-v1']),
});

/**
 * Structured browser qualification for the portable client profile, exposed to
 * preflight and the UI. Only engines that passed the real containment and
 * lifecycle harness appear here; detection feeds the same list on both sides, so
 * an unsupported or unknown engine is refused before any download.
 */
export const OR3_PLUGIN_V2_CLIENT_PROFILE = Object.freeze({
    profile: PORTABLE_PROFILE_NAME,
    qualifiedBrowsers: Object.freeze([...QUALIFIED_BROWSER_ENGINES]),
});
