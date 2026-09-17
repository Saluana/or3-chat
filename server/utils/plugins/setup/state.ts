/**
 * Host setup state.
 *
 * One loader builds everything the setup page and the first-action handoff need:
 * the installed package's descriptors, the validated settings currently in
 * effect, the stored connections bound to the package's declared slots, and the
 * registered host provider capabilities. Both endpoints read this same state, so
 * the GET plan and the POST handoff cannot disagree about readiness.
 */

import {
    buildFirstActionHandoff,
    buildSetupPlan,
    describeSetupStatus,
    type FirstActionHandoff,
    type HostConnectionCapability,
    type SetupConnectionState,
    type SetupPlan,
} from '~~/shared/plugins/setup/plan';
import {
    validateSetupValues,
    type SetupValueError,
} from '~~/shared/plugins/setup/values';
import type {
    Or3PackagePolicyV1,
    Or3SetupDescriptorV1,
    PortableProfileFieldValue,
} from '@or3/plugin-sdk/profile';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import type { PluginConnectionService } from '../connections/service';
import { listConnectionProviders } from '../connections/providers/registry';
import { loadPackageDescriptors } from './load-descriptors';
import { resolvePluginPackage } from './discovery';

export interface SetupDestinationView {
    readonly id: string;
    readonly hosts: readonly string[];
    readonly methods: readonly string[];
    readonly scopes: readonly string[];
}

export interface SetupState {
    readonly pluginId: string;
    readonly installed: boolean;
    readonly plan: SetupPlan | null;
    readonly status: ReturnType<typeof describeSetupStatus>;
    readonly firstAction: FirstActionHandoff;
    readonly problems: readonly string[];
    readonly destinations: readonly SetupDestinationView[];
    readonly durableConnections: boolean;
    readonly credentialsAvailable: boolean;
    /** Validated settings in effect; the only source the form hydrates from. */
    readonly values: Readonly<Record<string, PortableProfileFieldValue>>;
    readonly settingsErrors: readonly SetupValueError[];
    /** Package descriptors, when they loaded; used by the connection routes. */
    readonly setup: Or3SetupDescriptorV1 | null;
    readonly policy: Or3PackagePolicyV1 | null;
}

export interface LoadSetupStateInput {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly ownerUserId: string;
    readonly hasSelectedContext: boolean;
    readonly service: PluginConnectionService;
    readonly durableConnections: boolean;
    /** Saved settings document for this plugin, or an empty object. */
    readonly storedValues: Readonly<Record<string, unknown>>;
}

/** Registered provider capabilities, projected for plan validation. */
export function hostConnectionCapabilities(): readonly HostConnectionCapability[] {
    return listConnectionProviders().map((provider) => ({
        provider: provider.id,
        // Contracts call a browser-held key `browser-pkce`; the package profile
        // calls the same mechanism `browser`.
        mechanism: provider.mechanism === 'server' ? 'server' : 'browser',
        scopes: [...provider.scopes],
        operations: provider.operations.map((operation) => operation.id),
    }));
}

export async function loadSetupState(input: LoadSetupStateInput): Promise<SetupState> {
    // The resolved package may be an immutable candidate awaiting setup (an
    // acquisition), not only a legacy extension directory.
    const installed = await resolvePluginPackage(input.pluginId);

    const destinations: SetupDestinationView[] = [];
    if (!installed) {
        return {
            pluginId: input.pluginId,
            installed: false,
            plan: null,
            status: { status: 'blocked', label: 'Not installed', blocked: true },
            firstAction: {
                operationId: '',
                label: 'Unavailable',
                contextKind: 'sample',
                ready: false,
                reason: 'This plugin is not installed',
            },
            problems: ['This plugin is not installed'],
            destinations,
            durableConnections: input.durableConnections,
            credentialsAvailable: input.service.available,
            values: Object.freeze({}),
            settingsErrors: Object.freeze([]),
            setup: null,
            policy: null,
        };
    }

    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: installed.path,
    });
    for (const destination of descriptors.policy?.destinations ?? []) {
        destinations.push({
            id: destination.id,
            hosts: [...destination.hosts],
            methods: [...destination.methods],
            scopes: [...destination.scopes],
        });
    }

    const problems = [...descriptors.problems];

    if (!descriptors.setup || !descriptors.policy) {
        return {
            pluginId: input.pluginId,
            installed: true,
            plan: null,
            status: { status: 'blocked', label: 'Setup unavailable', blocked: true },
            firstAction: {
                operationId: '',
                label: 'Unavailable',
                contextKind: 'sample',
                ready: false,
                reason: 'The package setup descriptor is unavailable',
            },
            problems,
            destinations,
            durableConnections: input.durableConnections,
            credentialsAvailable: input.service.available,
            values: Object.freeze({}),
            settingsErrors: Object.freeze([]),
            setup: descriptors.setup,
            policy: descriptors.policy,
        };
    }

    // Stored settings are re-validated against the installed schema on read: a
    // package update can invalidate a saved value, and an invalid value must not
    // count as supplied.
    const validated = validateSetupValues({
        fields: descriptors.setup.fields,
        values: input.storedValues,
    });
    for (const error of validated.errors) {
        problems.push(`Saved setting "${error.key}" is no longer valid: ${error.message}`);
    }
    for (const key of validated.unknownKeys) {
        problems.push(`Saved setting "${key}" is not declared by this package`);
    }

    const stored = await input.service.list({
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        pluginId: input.pluginId,
    });

    // Bindings are explicit: a stored connection satisfies only the declared
    // slot it was created for.
    const connectionStates: SetupConnectionState[] = [];
    const claimed = new Set<string>();
    for (const connection of stored) {
        if (connection.slotId === undefined || claimed.has(connection.slotId)) continue;
        const testPassed = await input.service.isTestCurrent(connection.id);
        // Prefer a tested binding when several credentials claim one slot.
        const existing = connectionStates.find(
            (state) => state.slotId === connection.slotId
        );
        if (existing && existing.testPassed && !testPassed) continue;
        claimed.add(connection.slotId);
        const state: SetupConnectionState = {
            slotId: connection.slotId,
            connectionId: connection.id,
            ref: connection.ref,
            providerId: connection.providerId,
            scopes: [...connection.scopes],
            testPassed,
        };
        const index = connectionStates.findIndex(
            (candidate) => candidate.slotId === connection.slotId
        );
        if (index === -1) connectionStates.push(state);
        else connectionStates[index] = state;
    }

    const plan = buildSetupPlan({
        setup: descriptors.setup,
        policy: descriptors.policy,
        connectionStates,
        hostConnections: hostConnectionCapabilities(),
        values: validated.values,
    });

    return {
        pluginId: input.pluginId,
        installed: true,
        plan,
        status: describeSetupStatus(plan),
        firstAction: buildFirstActionHandoff({
            plan,
            hasSelectedContext: input.hasSelectedContext,
        }),
        problems: Object.freeze(problems),
        destinations: Object.freeze(destinations),
        durableConnections: input.durableConnections,
        credentialsAvailable: input.service.available,
        values: validated.values,
        settingsErrors: validated.errors,
        setup: descriptors.setup,
        policy: descriptors.policy,
    };
}
