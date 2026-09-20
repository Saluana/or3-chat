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
import type { H3Event } from 'h3';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import type { PluginConnectionService } from '../connections/service';
import { listConnectionProviders } from '../connections/providers/registry';
import { loadPackageDescriptors } from './load-descriptors';
import {
    resolvePluginPackage,
    type PackageSelectionIssue,
    type PluginPackageSlot,
    type ResolvedPluginPackage,
    type VerifiedPackageSelectionStatus,
} from './discovery';
import { readSetupValuesSnapshot } from './settings-store';

export interface SetupDestinationView {
    readonly id: string;
    readonly hosts: readonly string[];
    readonly methods: readonly string[];
    readonly scopes: readonly string[];
}

/** Verified selection summary for callers that must distinguish blocked from missing. */
export interface SetupSelectionView {
    readonly status: VerifiedPackageSelectionStatus;
    readonly selectedSlot: 'current' | 'previous' | 'candidate' | null;
    readonly pointerRevision: number | null;
    readonly issues: readonly PackageSelectionIssue[];
}

export interface SetupState {
    readonly pluginId: string;
    readonly installed: boolean;
    /** Exact package these values belong to; null for a legacy extension. */
    readonly packageDigest: string | null;
    /** Verified selection this state was built from; null when nothing resolved. */
    readonly selection: SetupSelectionView | null;
    readonly plan: SetupPlan | null;
    readonly status: ReturnType<typeof describeSetupStatus>;
    readonly firstAction: FirstActionHandoff;
    readonly problems: readonly string[];
    readonly destinations: readonly SetupDestinationView[];
    readonly durableConnections: boolean;
    readonly credentialsAvailable: boolean;
    /** Validated settings in effect; the only source the form hydrates from. */
    readonly values: Readonly<Record<string, PortableProfileFieldValue>>;
    /** Revision of the exact document `values` was read from. */
    readonly setupRevision: number;
    readonly settingsErrors: readonly SetupValueError[];
    /** Package descriptors, when they loaded; used by the connection routes. */
    readonly setup: Or3SetupDescriptorV1 | null;
    readonly policy: Or3PackagePolicyV1 | null;
}

export interface LoadSetupStateInput {
    readonly event: H3Event;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly ownerUserId: string;
    readonly hasSelectedContext: boolean;
    readonly service: PluginConnectionService;
    readonly durableConnections: boolean;
    /** Operation-owned candidate overlay to hydrate when setup is pending. */
    readonly setupOperationId?: string;
    /**
     * `auto` resolves a pending candidate (setup for an install/update);
     * `current` resolves the running selection (runtime settings reads).
     */
    readonly slot?: PluginPackageSlot;
    /**
     * Pre-resolved verified selection. Callers that already resolved and bound
     * the package pass it so the plan cannot be built from a second, possibly
     * different, resolution.
     */
    readonly selection?: ResolvedPluginPackage;
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
    // The verified selection may be an immutable candidate awaiting setup (an
    // acquisition) or the recovered previous version, not only a legacy
    // extension directory. Runtime reads pass `current` so they never follow an
    // unpromoted candidate. A blocked V2 pointer is never replaced by a legacy
    // directory with the same id.
    const selection =
        input.selection ??
        (await resolvePluginPackage(
            input.pluginId,
            EXTENSIONS_BASE_DIR,
            input.slot ?? 'auto'
        ));
    const selectionView: SetupSelectionView | null = selection
        ? {
              status: selection.status,
              selectedSlot: selection.selectedSlot,
              pointerRevision: selection.pointerRevision,
              issues: selection.issues,
          }
        : null;
    // A blocked/inactive selection carries no path; it resolves to no state.
    const installed = selection !== null && selection.path !== null;
    const current = await resolvePluginPackage(
        input.pluginId,
        EXTENSIONS_BASE_DIR,
        'current'
    );
    const storedValues = installed
        ? await readSetupValuesSnapshot(input.event, input.workspaceId, input.pluginId, {
              packageDigest: selection.digest,
              ...(input.setupOperationId === undefined
                  ? {}
                  : { operationId: input.setupOperationId }),
              ...(current?.digest === null || current?.digest === undefined
                  ? {}
                  : { basePackageDigest: current.digest }),
          })
        : { values: {}, revision: 0 };

    const destinations: SetupDestinationView[] = [];
    if (!installed || !selection.path) {
        const blockedIssues = selection?.issues.map((issue) => issue.message) ?? [];
        const problems = selection
            ? blockedIssues.length > 0
                ? blockedIssues
                : ['This plugin is not installed']
            : ['This plugin is not installed'];
        return {
            pluginId: input.pluginId,
            installed: false,
            packageDigest: null,
            selection: selectionView,
            plan: null,
            status: {
                status: 'blocked',
                label: 'Not installed',
                blocked: true,
            },
            firstAction: {
                operationId: '',
                label: 'Unavailable',
                contextKind: 'sample',
                ready: false,
                reason:
                    selection?.status === 'blocked'
                        ? 'This plugin package is blocked'
                        : 'This plugin is not installed',
            },
            problems,
            destinations,
            durableConnections: input.durableConnections,
            credentialsAvailable: input.service.available,
            values: Object.freeze({}),
            setupRevision: storedValues.revision,
            settingsErrors: Object.freeze([]),
            setup: null,
            policy: null,
        };
    }

    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: selection.path,
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
            packageDigest: selection.digest,
            selection: selectionView,
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
            setupRevision: storedValues.revision,
            settingsErrors: Object.freeze([]),
            setup: descriptors.setup,
            policy: descriptors.policy,
        };
    }

    // Stored settings are re-validated against the resolved package's schema on
    // read: a package update can invalidate a saved value, and an invalid value
    // must not count as supplied.
    const validated = validateSetupValues({
        fields: descriptors.setup.fields,
        values: storedValues.values,
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
        packageDigest: selection.digest,
        selection: selectionView,
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
        setupRevision: storedValues.revision,
        settingsErrors: validated.errors,
        setup: descriptors.setup,
        policy: descriptors.policy,
    };
}
