import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watch } from 'vue';
import { createRegistry } from '../_registry';
import { ActivationTable } from '~~/shared/plugins/activation-table';
import { ContributionRegistry } from '~~/shared/plugins/contribution-registry';
import {
    captureDifferentialSurface,
    compareDifferentialSurfaces,
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
    type DifferentialSurfaceAdapter,
    type DifferentialSurfaceFixture,
} from '../../../tests/plugin-runtime/differential-surface-harness';

type Item = { id: string; order?: number; label: string };

const fixture: DifferentialSurfaceFixture<Item> = {
    profileId: 'registry.message-actions',
    registrations: [
        { id: 'b', label: 'first' },
        { id: 'b', label: 'replacement' },
        { id: 'a', label: 'default' },
        { id: 'early', order: 100, label: 'early' },
    ],
    disposeRegistrations: [0],
    unregisterIds: ['early'],
};

const projectValue = (value: Item) => ({
    id: value.id,
    order: value.order ?? 200,
    label: value.label,
});

describe('differential surface adapter harness', () => {
    it('binds a V1/V2 comparison to a frozen Compatibility Ledger profile', () => {
        const profiles = JSON.parse(
            readFileSync(
                resolve(process.cwd(), 'planning/complete/plugin-runtime-v2/compatibility-profiles.json'),
                'utf8'
            )
        ) as CompatibilityProfileDocument;
        const profile = requireCompatibilityProfile(profiles, fixture.profileId);
        expect(profile.behavior).toMatchObject({
            duplicate: 'replace-by-id',
            storedValue: 'shallow-frozen-copy',
            defaultOrder: 200,
            equalOrderTie: 'id-ascending',
            registerReturn: 'RegistrationHandle',
            disposal: 'exact-owner',
        });

        const v1 = createRegistry<Item>(`__or3_differential_${crypto.randomUUID()}`);
        const v1Items = v1.useItems();
        const v1Adapter: DifferentialSurfaceAdapter<Item> = {
            register: v1.register,
            unregister: v1.unregister,
            snapshot: () => v1Items.value,
            subscribe: (listener) => watch(v1Items, listener, { flush: 'sync' }),
        };

        const activationTable = new ActivationTable();
        const kernel = new ContributionRegistry<Item, void>({
            activationTable,
            getId: (value) => value.id,
            normalize: (value) => Object.freeze({ ...value }),
            compare: (left, right) =>
                (left.order ?? 200) - (right.order ?? 200) || left.id.localeCompare(right.id),
        });
        const v2Adapter: DifferentialSurfaceAdapter<Item> = {
            register: (value) => kernel.registerLegacy({ value }),
            unregister: (id) => {
                kernel.unregisterLegacy(id);
            },
            snapshot: () => kernel.snapshot(undefined),
            subscribe: (listener) => kernel.subscribe(listener),
        };

        const expected = captureDifferentialSurface({
            fixture,
            adapter: v1Adapter,
            getId: (value) => value.id,
            projectValue,
        });
        const actual = captureDifferentialSurface({
            fixture,
            adapter: v2Adapter,
            getId: (value) => value.id,
            projectValue,
        });

        expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
        expect(actual).toMatchObject({
            projectedIds: ['a', 'b'],
            frozenById: { a: true, b: true },
            sourceIdentityById: { a: false, b: false },
            notificationCount: 5,
        });
    });

    it('reports exception, identity, return, order, and notification differences', () => {
        const base = Object.freeze({
            profileId: 'fixture',
            projectedValues: Object.freeze([{ id: 'a' }]),
            projectedIds: Object.freeze(['a']),
            frozenById: Object.freeze({ a: true }),
            sourceIdentityById: Object.freeze({ a: false }),
            registerReturns: Object.freeze([{ kind: 'undefined' as const }]),
            disposeReturns: Object.freeze([]),
            unregisterReturns: Object.freeze([]),
            exceptions: Object.freeze([]),
            notificationCount: 1,
        });
        const changed = {
            ...base,
            projectedIds: ['b'],
            sourceIdentityById: { a: true },
            registerReturns: [{ kind: 'disposer-function' as const }],
            exceptions: [{ operation: 'register:0', name: 'Error', message: 'boom' }],
            notificationCount: 2,
        };

        expect(compareDifferentialSurfaces(base, changed)).toEqual([
            'projectedIds differs',
            'sourceIdentityById differs',
            'registerReturns differs',
            'exceptions differs',
            'notificationCount differs',
        ]);
    });
});
