import { satisfies, valid, validRange } from 'semver';

export interface PluginV2GraphDependency {
    readonly id: string;
    readonly range: string;
}

export interface PluginV2GraphNode {
    readonly id: string;
    readonly version: string;
    readonly dependencies: {
        readonly required: readonly PluginV2GraphDependency[];
        readonly optional: readonly PluginV2GraphDependency[];
    };
}

export type PluginV2DependencyBlockCode =
    | 'duplicate-plugin-id'
    | 'invalid-plugin-version'
    | 'invalid-dependency-range'
    | 'missing-required-dependency'
    | 'dependency-version-mismatch'
    | 'dependency-cycle'
    | 'required-dependency-blocked';

export interface PluginV2DependencyBlock {
    readonly code: PluginV2DependencyBlockCode;
    readonly pluginId: string;
    readonly dependencyId?: string;
    readonly expected?: string;
    readonly actual?: string;
    readonly cyclePath?: readonly string[];
    readonly message: string;
}

export interface PluginV2OptionalDependencyUnavailable {
    readonly id: string;
    readonly reason: 'missing' | 'invalid-range' | 'version-mismatch' | 'blocked';
    readonly expected?: string;
    readonly actual?: string;
}

export interface PluginV2DependencyResolution {
    readonly pluginId: string;
    readonly required: readonly string[];
    readonly optionalAvailable: readonly string[];
    readonly optionalUnavailable: readonly PluginV2OptionalDependencyUnavailable[];
}

export interface PluginV2DependencyGraphResult {
    readonly status: 'resolved' | 'blocked';
    readonly startOrder: readonly string[];
    readonly stopOrder: readonly string[];
    readonly blocked: Readonly<Record<string, readonly PluginV2DependencyBlock[]>>;
    readonly resolutions: Readonly<Record<string, PluginV2DependencyResolution>>;
}

function freeze<T extends object>(value: T): Readonly<T> {
    return Object.freeze(value);
}

function insertSorted(values: string[], value: string): void {
    const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0);
    if (index === -1) values.push(value);
    else values.splice(index, 0, value);
}

function cyclePath(
    component: readonly string[],
    edges: ReadonlyMap<string, readonly string[]>
): string[] {
    const members = new Set(component);
    const start = [...component].sort()[0]!;
    const path: string[] = [];
    const visiting = new Set<string>();
    const visit = (id: string): string[] | undefined => {
        path.push(id);
        visiting.add(id);
        const dependencies = (edges.get(id) ?? [])
            .filter((entry) => members.has(entry))
            .sort();
        for (const dependency of dependencies) {
            if (dependency === start) return [...path, start];
            if (!visiting.has(dependency)) {
                const found = visit(dependency);
                if (found) return found;
            }
        }
        visiting.delete(id);
        path.pop();
        return undefined;
    };
    return visit(start) ?? [...component].sort().concat(start);
}

function stronglyConnectedComponents(
    ids: readonly string[],
    edges: ReadonlyMap<string, readonly string[]>
): string[][] {
    let nextIndex = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const components: string[][] = [];
    const visit = (id: string) => {
        indices.set(id, nextIndex);
        lowlinks.set(id, nextIndex);
        nextIndex += 1;
        stack.push(id);
        onStack.add(id);
        for (const dependency of [...(edges.get(id) ?? [])].sort()) {
            if (!indices.has(dependency)) {
                visit(dependency);
                lowlinks.set(id, Math.min(lowlinks.get(id)!, lowlinks.get(dependency)!));
            } else if (onStack.has(dependency)) {
                lowlinks.set(id, Math.min(lowlinks.get(id)!, indices.get(dependency)!));
            }
        }
        if (lowlinks.get(id) !== indices.get(id)) return;
        const component: string[] = [];
        let member: string;
        do {
            member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
        } while (member !== id);
        components.push(component.sort());
    };
    for (const id of [...ids].sort()) {
        if (!indices.has(id)) visit(id);
    }
    return components;
}

/** Resolve the complete V2 dependency graph without importing plugin code. */
export function resolvePluginV2DependencyGraph(
    inputNodes: readonly PluginV2GraphNode[]
): PluginV2DependencyGraphResult {
    const nodes = new Map<string, PluginV2GraphNode>();
    const blocks = new Map<string, PluginV2DependencyBlock[]>();
    const requiredEdges = new Map<string, string[]>();
    const optionalEdges = new Map<string, string[]>();
    const optionalUnavailable = new Map<string, PluginV2OptionalDependencyUnavailable[]>();
    const addBlock = (block: PluginV2DependencyBlock) => {
        const entries = blocks.get(block.pluginId) ?? [];
        entries.push(freeze(block));
        blocks.set(block.pluginId, entries);
    };

    for (const node of [...inputNodes].sort((left, right) => left.id.localeCompare(right.id))) {
        if (nodes.has(node.id)) {
            addBlock({
                code: 'duplicate-plugin-id',
                pluginId: node.id,
                message: `Dependency graph contains duplicate plugin id ${node.id}`,
            });
            continue;
        }
        nodes.set(node.id, node);
        requiredEdges.set(node.id, []);
        optionalEdges.set(node.id, []);
        optionalUnavailable.set(node.id, []);
        if (!valid(node.version)) {
            addBlock({
                code: 'invalid-plugin-version',
                pluginId: node.id,
                actual: node.version,
                message: `Plugin ${node.id} has an invalid semantic version`,
            });
        }
    }

    const inspect = (
        node: PluginV2GraphNode,
        dependency: PluginV2GraphDependency,
        optional: boolean
    ) => {
        const target = nodes.get(dependency.id);
        const unavailable = optionalUnavailable.get(node.id)!;
        if (!validRange(dependency.range)) {
            if (optional) {
                unavailable.push({
                    id: dependency.id,
                    reason: 'invalid-range',
                    expected: dependency.range,
                });
            } else {
                addBlock({
                    code: 'invalid-dependency-range',
                    pluginId: node.id,
                    dependencyId: dependency.id,
                    expected: dependency.range,
                    message: `Required dependency ${dependency.id} has an invalid range`,
                });
            }
            return;
        }
        if (!target) {
            if (optional) unavailable.push({ id: dependency.id, reason: 'missing' });
            else {
                addBlock({
                    code: 'missing-required-dependency',
                    pluginId: node.id,
                    dependencyId: dependency.id,
                    expected: dependency.range,
                    message: `Required dependency ${dependency.id} is missing`,
                });
            }
            return;
        }
        if (!valid(target.version) || !satisfies(target.version, dependency.range)) {
            if (optional) {
                unavailable.push({
                    id: dependency.id,
                    reason: 'version-mismatch',
                    expected: dependency.range,
                    actual: target.version,
                });
            } else {
                addBlock({
                    code: 'dependency-version-mismatch',
                    pluginId: node.id,
                    dependencyId: dependency.id,
                    expected: dependency.range,
                    actual: target.version,
                    message: `Required dependency ${dependency.id} has an incompatible version`,
                });
            }
            return;
        }
        (optional ? optionalEdges : requiredEdges).get(node.id)!.push(dependency.id);
    };

    for (const node of nodes.values()) {
        for (const dependency of node.dependencies.required) inspect(node, dependency, false);
        for (const dependency of node.dependencies.optional) inspect(node, dependency, true);
        requiredEdges.get(node.id)!.sort();
        optionalEdges.get(node.id)!.sort();
    }

    const allEdges = new Map<string, readonly string[]>();
    for (const id of nodes.keys()) {
        allEdges.set(id, [...requiredEdges.get(id)!, ...optionalEdges.get(id)!].sort());
    }
    for (const component of stronglyConnectedComponents([...nodes.keys()], allEdges)) {
        const selfCycle =
            component.length === 1 &&
            allEdges.get(component[0]!)?.includes(component[0]!);
        if (component.length === 1 && !selfCycle) continue;
        const path = Object.freeze(cyclePath(component, allEdges));
        for (const pluginId of component) {
            addBlock({
                code: 'dependency-cycle',
                pluginId,
                cyclePath: path,
                message: `Dependency cycle detected: ${path.join(' -> ')}`,
            });
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const [pluginId, dependencies] of requiredEdges) {
            if (blocks.has(pluginId)) continue;
            const blockedDependency = dependencies.find((dependencyId) => blocks.has(dependencyId));
            if (!blockedDependency) continue;
            addBlock({
                code: 'required-dependency-blocked',
                pluginId,
                dependencyId: blockedDependency,
                message: `Required dependency ${blockedDependency} is blocked`,
            });
            changed = true;
        }
    }

    for (const [pluginId, dependencies] of optionalEdges) {
        optionalEdges.set(
            pluginId,
            dependencies.filter((dependencyId) => {
                if (!blocks.has(dependencyId)) return true;
                optionalUnavailable.get(pluginId)!.push({ id: dependencyId, reason: 'blocked' });
                return false;
            })
        );
    }

    const eligible = [...nodes.keys()].filter((id) => !blocks.has(id)).sort();
    const eligibleSet = new Set(eligible);
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const id of eligible) {
        const dependencies = [...requiredEdges.get(id)!, ...optionalEdges.get(id)!].filter(
            (entry) => eligibleSet.has(entry)
        );
        indegree.set(id, dependencies.length);
        for (const dependency of dependencies) {
            const entries = dependents.get(dependency) ?? [];
            entries.push(id);
            dependents.set(dependency, entries);
        }
    }
    const ready = eligible.filter((id) => indegree.get(id) === 0);
    const startOrder: string[] = [];
    while (ready.length > 0) {
        const id = ready.shift()!;
        startOrder.push(id);
        for (const dependent of (dependents.get(id) ?? []).sort()) {
            const remaining = indegree.get(dependent)! - 1;
            indegree.set(dependent, remaining);
            if (remaining === 0) insertSorted(ready, dependent);
        }
    }

    const blockedRecord: Record<string, readonly PluginV2DependencyBlock[]> = {};
    const resolutions: Record<string, PluginV2DependencyResolution> = {};
    for (const id of [...nodes.keys()].sort()) {
        if (blocks.has(id)) blockedRecord[id] = Object.freeze(blocks.get(id)!);
        resolutions[id] = freeze({
            pluginId: id,
            required: Object.freeze([...requiredEdges.get(id)!]),
            optionalAvailable: Object.freeze([...optionalEdges.get(id)!]),
            optionalUnavailable: Object.freeze(
                optionalUnavailable.get(id)!.map((entry) => freeze({ ...entry }))
            ),
        });
    }
    return freeze({
        status: blocks.size > 0 ? 'blocked' : 'resolved',
        startOrder: Object.freeze(startOrder),
        stopOrder: Object.freeze([...startOrder].reverse()),
        blocked: freeze(blockedRecord),
        resolutions: freeze(resolutions),
    });
}

/** A manager must consult this result before invoking a loader for a graph member. */
export function canLoadPluginV2GraphNode(
    result: PluginV2DependencyGraphResult,
    pluginId: string
): boolean {
    return result.startOrder.includes(pluginId) && result.blocked[pluginId] === undefined;
}
