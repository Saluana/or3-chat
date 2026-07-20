export interface ActivationChange {
    readonly pluginId: string;
    readonly previous: symbol | undefined;
    readonly next: symbol | undefined;
    readonly revision: number;
}

export interface ActivationSnapshotEntry {
    readonly pluginId: string;
    readonly owner: symbol;
}

export type ActivationListener = (change: ActivationChange) => void;

/**
 * The one synchronous visibility pointer shared by contributions and hooks.
 * Publication contains no await and only succeeds for the expected owner.
 */
export class ActivationTable {
    readonly #current = new Map<string, symbol>();
    readonly #listeners = new Set<ActivationListener>();
    #revision = 0;

    get revision(): number {
        return this.#revision;
    }

    current(pluginId: string): symbol | undefined {
        return this.#current.get(pluginId);
    }

    isCurrent(pluginId: string, owner: symbol): boolean {
        return this.#current.get(pluginId) === owner;
    }

    publish(input: {
        pluginId: string;
        expected: symbol | undefined;
        next: symbol;
    }): boolean {
        return this.compareAndSwap({ ...input, next: input.next });
    }

    compareAndSwap(input: {
        pluginId: string;
        expected: symbol | undefined;
        next: symbol | undefined;
    }): boolean {
        const previous = this.#current.get(input.pluginId);
        if (previous !== input.expected) return false;
        if (input.next === undefined) this.#current.delete(input.pluginId);
        else this.#current.set(input.pluginId, input.next);
        const change = Object.freeze({
            pluginId: input.pluginId,
            previous,
            next: input.next,
            revision: ++this.#revision,
        });
        for (const listener of Array.from(this.#listeners)) listener(change);
        return true;
    }

    subscribe(listener: ActivationListener): () => void {
        this.#listeners.add(listener);
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            this.#listeners.delete(listener);
        };
    }

    snapshot(): readonly ActivationSnapshotEntry[] {
        return Object.freeze(
            Array.from(this.#current, ([pluginId, owner]) =>
                Object.freeze({ pluginId, owner })
            ).sort((left, right) => left.pluginId.localeCompare(right.pluginId))
        );
    }
}
