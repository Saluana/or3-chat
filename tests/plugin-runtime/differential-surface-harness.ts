export interface DifferentialSurfaceAdapter<TRegistration, TProjection = TRegistration> {
    register(value: TRegistration): unknown;
    unregister(id: string): unknown;
    snapshot(): readonly TProjection[];
    subscribe(listener: () => void): () => void;
}

export interface DifferentialSurfaceFixture<T> {
    readonly profileId: string;
    readonly registrations: readonly T[];
    readonly disposeRegistrations?: readonly number[];
    readonly unregisterIds?: readonly string[];
}

export interface DifferentialExceptionObservation {
    readonly operation: string;
    readonly name: string;
    readonly message: string;
}

export type DifferentialReturnObservation =
    | { readonly kind: 'undefined' }
    | { readonly kind: 'registration-handle'; readonly id: string }
    | { readonly kind: 'disposer-function' }
    | { readonly kind: 'boolean'; readonly value: boolean }
    | { readonly kind: 'other'; readonly type: string };

export interface DifferentialSurfaceObservation {
    readonly profileId: string;
    readonly projectedValues: readonly unknown[];
    readonly projectedIds: readonly string[];
    readonly frozenById: Readonly<Record<string, boolean>>;
    readonly sourceIdentityById: Readonly<Record<string, boolean>>;
    readonly registerReturns: readonly DifferentialReturnObservation[];
    readonly disposeReturns: readonly DifferentialReturnObservation[];
    readonly unregisterReturns: readonly DifferentialReturnObservation[];
    readonly exceptions: readonly DifferentialExceptionObservation[];
    readonly notificationCount: number;
}

export interface CompatibilityProfileDocument {
    readonly schemaVersion: number;
    readonly profiles: ReadonlyArray<{
        readonly id: string;
        readonly family: string;
        readonly behavior: Readonly<Record<string, unknown>>;
    }>;
}

export function requireCompatibilityProfile(
    document: CompatibilityProfileDocument,
    profileId: string
): CompatibilityProfileDocument['profiles'][number] {
    const profile = document.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error(`Unknown compatibility profile: ${profileId}`);
    return profile;
}

function observeReturn(value: unknown): DifferentialReturnObservation {
    if (value === undefined) return { kind: 'undefined' };
    if (typeof value === 'boolean') return { kind: 'boolean', value };
    if (typeof value === 'function') return { kind: 'disposer-function' };
    if (
        value &&
        typeof value === 'object' &&
        typeof (value as { id?: unknown }).id === 'string' &&
        typeof (value as { owner?: unknown }).owner === 'symbol' &&
        typeof (value as { dispose?: unknown }).dispose === 'function'
    ) {
        return { kind: 'registration-handle', id: (value as { id: string }).id };
    }
    return { kind: 'other', type: value === null ? 'null' : typeof value };
}

function observeException(operation: string, error: unknown): DifferentialExceptionObservation {
    return Object.freeze({
        operation,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
    });
}

export function captureDifferentialSurface<TRegistration, TProjection = TRegistration>(input: {
    fixture: DifferentialSurfaceFixture<TRegistration>;
    adapter: DifferentialSurfaceAdapter<TRegistration, TProjection>;
    getId: (value: TRegistration) => string;
    getProjectedId?: (value: TProjection) => string;
    identityValue?: (value: TProjection) => unknown;
    projectValue: (value: TProjection) => unknown;
}): DifferentialSurfaceObservation {
    let notificationCount = 0;
    const stop = input.adapter.subscribe(() => {
        notificationCount += 1;
    });
    const exceptions: DifferentialExceptionObservation[] = [];
    const returns: unknown[] = [];
    const lastSourceById = new Map<string, TRegistration>();
    for (let index = 0; index < input.fixture.registrations.length; index++) {
        const value = input.fixture.registrations[index]!;
        lastSourceById.set(input.getId(value), value);
        try {
            returns.push(input.adapter.register(value));
        } catch (error) {
            returns.push(undefined);
            exceptions.push(observeException(`register:${index}`, error));
        }
    }

    const disposeReturns: DifferentialReturnObservation[] = [];
    for (const index of input.fixture.disposeRegistrations ?? []) {
        const handle = returns[index] as { dispose?: () => unknown } | undefined;
        try {
            disposeReturns.push(observeReturn(handle?.dispose?.()));
        } catch (error) {
            disposeReturns.push(observeReturn(undefined));
            exceptions.push(observeException(`dispose:${index}`, error));
        }
    }

    const unregisterReturns: DifferentialReturnObservation[] = [];
    for (const id of input.fixture.unregisterIds ?? []) {
        try {
            unregisterReturns.push(observeReturn(input.adapter.unregister(id)));
        } catch (error) {
            unregisterReturns.push(observeReturn(undefined));
            exceptions.push(observeException(`unregister:${id}`, error));
        }
    }

    const snapshot = input.adapter.snapshot();
    stop();
    const frozenById: Record<string, boolean> = {};
    const sourceIdentityById: Record<string, boolean> = {};
    for (const value of snapshot) {
        const id = input.getProjectedId
            ? input.getProjectedId(value)
            : input.getId(value as unknown as TRegistration);
        const identityValue = input.identityValue?.(value) ?? value;
        frozenById[id] = Object.isFrozen(identityValue);
        sourceIdentityById[id] = lastSourceById.get(id) === identityValue;
    }
    return Object.freeze({
        profileId: input.fixture.profileId,
        projectedValues: Object.freeze(snapshot.map(input.projectValue)),
        projectedIds: Object.freeze(
            snapshot.map((value) =>
                input.getProjectedId
                    ? input.getProjectedId(value)
                    : input.getId(value as unknown as TRegistration)
            )
        ),
        frozenById: Object.freeze(frozenById),
        sourceIdentityById: Object.freeze(sourceIdentityById),
        registerReturns: Object.freeze(returns.map(observeReturn)),
        disposeReturns: Object.freeze(disposeReturns),
        unregisterReturns: Object.freeze(unregisterReturns),
        exceptions: Object.freeze(exceptions),
        notificationCount,
    });
}

export function compareDifferentialSurfaces(
    expected: DifferentialSurfaceObservation,
    actual: DifferentialSurfaceObservation
): readonly string[] {
    const fields: Array<keyof DifferentialSurfaceObservation> = [
        'profileId',
        'projectedValues',
        'projectedIds',
        'frozenById',
        'sourceIdentityById',
        'registerReturns',
        'disposeReturns',
        'unregisterReturns',
        'exceptions',
        'notificationCount',
    ];
    return Object.freeze(
        fields.flatMap((field) =>
            JSON.stringify(expected[field]) === JSON.stringify(actual[field])
                ? []
                : [`${field} differs`]
        )
    );
}
