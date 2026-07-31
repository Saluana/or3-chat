import { describe, expect, it } from 'vitest';
import {
    canLoadPluginV2GraphNode,
    resolvePluginV2DependencyGraph,
    type PluginV2GraphNode,
} from '../v2-dependency-graph';

function node(
    id: string,
    required: Array<{ id: string; range: string }> = [],
    optional: Array<{ id: string; range: string }> = [],
    version = '1.0.0'
): PluginV2GraphNode {
    return { id, version, dependencies: { required, optional } };
}

describe('Plugin V2 dependency graph', () => {
    it('orders startup dependency-first and shutdown dependent-first', () => {
        const result = resolvePluginV2DependencyGraph([
            node('acme.ui', [{ id: 'acme.search', range: '^1.0.0' }]),
            node('acme.core'),
            node('acme.search', [{ id: 'acme.core', range: '^1.0.0' }]),
        ]);

        expect(result.status).toBe('resolved');
        expect(result.startOrder).toEqual(['acme.core', 'acme.search', 'acme.ui']);
        expect(result.stopOrder).toEqual(['acme.ui', 'acme.search', 'acme.core']);
    });

    it('is deterministic regardless of discovery order', () => {
        const nodes = [node('zeta'), node('alpha'), node('middle')];

        expect(resolvePluginV2DependencyGraph(nodes).startOrder).toEqual([
            'alpha',
            'middle',
            'zeta',
        ]);
        expect(resolvePluginV2DependencyGraph([...nodes].reverse()).startOrder).toEqual([
            'alpha',
            'middle',
            'zeta',
        ]);
    });

    it('blocks missing and incompatible required dependencies before load eligibility', () => {
        const result = resolvePluginV2DependencyGraph([
            node('acme.core', [], [], '1.0.0'),
            node('acme.missing-user', [{ id: 'missing', range: '^1.0.0' }]),
            node('acme.version-user', [{ id: 'acme.core', range: '^2.0.0' }]),
        ]);

        expect(result.blocked['acme.missing-user']?.[0]?.code).toBe(
            'missing-required-dependency'
        );
        expect(result.blocked['acme.version-user']?.[0]?.code).toBe(
            'dependency-version-mismatch'
        );
        expect(canLoadPluginV2GraphNode(result, 'acme.missing-user')).toBe(false);
        expect(canLoadPluginV2GraphNode(result, 'acme.version-user')).toBe(false);
        expect(canLoadPluginV2GraphNode(result, 'acme.core')).toBe(true);
    });

    it('negotiates optional absence and incompatible versions without blocking', () => {
        const result = resolvePluginV2DependencyGraph([
            node(
                'acme.app',
                [],
                [
                    { id: 'acme.missing', range: '^1.0.0' },
                    { id: 'acme.telemetry', range: '^2.0.0' },
                ]
            ),
            node('acme.telemetry', [], [], '1.5.0'),
        ]);

        expect(result.status).toBe('resolved');
        expect(result.resolutions['acme.app']?.optionalAvailable).toEqual([]);
        expect(result.resolutions['acme.app']?.optionalUnavailable).toEqual([
            { id: 'acme.missing', reason: 'missing' },
            {
                id: 'acme.telemetry',
                reason: 'version-mismatch',
                expected: '^2.0.0',
                actual: '1.5.0',
            },
        ]);
    });

    it('orders a compatible optional dependency before its consumer', () => {
        const result = resolvePluginV2DependencyGraph([
            node('acme.app', [], [{ id: 'acme.telemetry', range: '^1.0.0' }]),
            node('acme.telemetry'),
        ]);

        expect(result.startOrder).toEqual(['acme.telemetry', 'acme.app']);
        expect(result.resolutions['acme.app']?.optionalAvailable).toEqual([
            'acme.telemetry',
        ]);
    });

    it('blocks every cycle member with a clear path and propagates to dependents', () => {
        const result = resolvePluginV2DependencyGraph([
            node('acme.a', [{ id: 'acme.b', range: '^1.0.0' }]),
            node('acme.b', [{ id: 'acme.c', range: '^1.0.0' }]),
            node('acme.c', [{ id: 'acme.a', range: '^1.0.0' }]),
            node('acme.consumer', [{ id: 'acme.a', range: '^1.0.0' }]),
            node('acme.unrelated'),
        ]);

        for (const id of ['acme.a', 'acme.b', 'acme.c']) {
            expect(result.blocked[id]?.[0]).toMatchObject({
                code: 'dependency-cycle',
                cyclePath: ['acme.a', 'acme.b', 'acme.c', 'acme.a'],
            });
            expect(canLoadPluginV2GraphNode(result, id)).toBe(false);
        }
        expect(result.blocked['acme.consumer']?.[0]).toMatchObject({
            code: 'required-dependency-blocked',
            dependencyId: 'acme.a',
        });
        expect(result.startOrder).toEqual(['acme.unrelated']);
    });

    it('detects self-cycles and duplicate plugin ids', () => {
        const selfCycle = resolvePluginV2DependencyGraph([
            node('acme.self', [{ id: 'acme.self', range: '^1.0.0' }]),
        ]);
        expect(selfCycle.blocked['acme.self']?.[0]).toMatchObject({
            code: 'dependency-cycle',
            cyclePath: ['acme.self', 'acme.self'],
        });

        const duplicate = resolvePluginV2DependencyGraph([
            node('acme.duplicate'),
            node('acme.duplicate'),
        ]);
        expect(duplicate.blocked['acme.duplicate']?.[0]?.code).toBe(
            'duplicate-plugin-id'
        );
    });

    it('blocks invalid plugin versions and dependency ranges without throwing', () => {
        const result = resolvePluginV2DependencyGraph([
            node('acme.invalid-version', [], [], 'development'),
            node('acme.invalid-range', [{ id: 'acme.invalid-version', range: 'wat' }]),
        ]);

        expect(result.blocked['acme.invalid-version']?.[0]?.code).toBe(
            'invalid-plugin-version'
        );
        expect(result.blocked['acme.invalid-range']?.[0]?.code).toBe(
            'invalid-dependency-range'
        );
    });

    it('marks an optional dependency unavailable when its own graph is blocked', () => {
        const result = resolvePluginV2DependencyGraph([
            node('acme.app', [], [{ id: 'acme.optional', range: '^1.0.0' }]),
            node('acme.optional', [{ id: 'missing', range: '^1.0.0' }]),
        ]);

        expect(result.blocked['acme.app']).toBeUndefined();
        expect(result.resolutions['acme.app']?.optionalUnavailable).toEqual([
            { id: 'acme.optional', reason: 'blocked' },
        ]);
        expect(result.startOrder).toEqual(['acme.app']);
    });
});
