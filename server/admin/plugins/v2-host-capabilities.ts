import type { PluginV2HostCapabilities } from '../../../shared/plugins/v2-compatibility';
import {
    PORTABLE_PROFILE_NAME,
    QUALIFIED_BROWSER_ENGINES,
} from '../../../shared/plugins/isolation/portable-bootstrap';
import { REMOTE_CAPABILITY_METHODS } from '../../../shared/plugins/isolation/capability-bridge';
import { SDK_LOGIC_RPC_METHODS } from '../../../shared/plugins/isolation/host-rpc-broker';
import { UI_CONTRIBUTE_EVENT } from '../../../shared/plugins/isolation/worker-runtime';

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
    readonly status: 'qualified' | 'unqualified';
    /** The callable method/event or qualification test that substantiates it. */
    readonly registration: Or3PluginV2GrantRegistration;
}

function sdkMethodsForGrant(grant: string): readonly string[] {
    return Object.entries(SDK_LOGIC_RPC_METHODS)
        .filter(([, methodGrant]) => methodGrant === grant)
        .map(([method]) => method);
}

export const OR3_PLUGIN_V2_GRANT_REGISTRY: readonly Or3PluginV2GrantQualification[] =
    Object.freeze([
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
    ]);

const qualifiedGrants = OR3_PLUGIN_V2_GRANT_REGISTRY
    .filter((entry) => entry.status === 'qualified')
    .map((entry) => entry.grant);

/** The first public V2 host contract. Keep it independent from app package
 * releases so package compatibility follows the documented plugin ABI.
 *
 * `isolated-client` is declared because the host now runs contained portable
 * clients: the entry bytes are served digest-addressed, verified in the browser,
 * and executed inside the opaque-origin sandbox. `trusted-host` remains declared
 * for server-side packages. Only grants the host actually honors appear here —
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
    pluginApiVersion: '2.0.0',
    supportedTrustModes: Object.freeze(['trusted-host', 'isolated-client'] as const),
    supportedGrants: Object.freeze(qualifiedGrants),
    supportedFeatures: Object.freeze(['or3-portable-client-v1']),
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
