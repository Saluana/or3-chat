import {
    ActivityEventSchema,
    ActivityRunStatusSchema,
    isTerminalActivityStatus,
    type ActivityEvent,
    type ActivityRunStatus,
} from './contract';

function eventIdentity(event: ActivityEvent): string {
    return `${event.sourceId}:${event.runId}:${event.id}`;
}

function statusFrom(event: ActivityEvent): ActivityRunStatus | undefined {
    if (event.type !== 'status') return undefined;
    const parsed = ActivityRunStatusSchema.safeParse(event.payload.status);
    return parsed.success ? parsed.data : undefined;
}

function mergeCoalesced(
    current: ActivityEvent,
    incoming: ActivityEvent
): ActivityEvent {
    if (
        current.type === 'message' &&
        incoming.type === 'message' &&
        incoming.payload.append === true &&
        typeof current.payload.text === 'string' &&
        typeof incoming.payload.text === 'string'
    ) {
        return Object.freeze({
            ...incoming,
            id: current.id,
            payload: Object.freeze({
                ...current.payload,
                ...incoming.payload,
                text: current.payload.text + incoming.payload.text,
            }),
        });
    }
    return Object.freeze({ ...incoming });
}

/**
 * Bounded normalized timeline projection. It owns no canonical run data.
 */
export class ActivityTimeline {
    readonly #events: ActivityEvent[] = [];
    readonly #identities = new Set<string>();
    readonly #coalescedIndexes = new Map<string, number>();
    readonly #maxEvents: number;
    #status?: ActivityRunStatus;
    #lastSequence = -1;

    constructor(options: { maxEvents?: number } = {}) {
        this.#maxEvents = Math.max(1, options.maxEvents ?? 500);
    }

    get status(): ActivityRunStatus | undefined {
        return this.#status;
    }

    get events(): readonly ActivityEvent[] {
        return Object.freeze([...this.#events]);
    }

    ingest(candidate: ActivityEvent): boolean {
        const parsed = ActivityEventSchema.safeParse(candidate);
        if (!parsed.success) return false;

        const identity = eventIdentity(candidate);
        if (this.#identities.has(identity)) return false;

        const nextStatus = statusFrom(candidate);
        if (
            nextStatus &&
            this.#status &&
            isTerminalActivityStatus(this.#status) &&
            nextStatus !== this.#status
        ) {
            return false;
        }
        if (
            candidate.sequence !== undefined &&
            candidate.sequence < this.#lastSequence
        ) {
            return false;
        }

        this.#identities.add(identity);
        if (candidate.sequence !== undefined) {
            this.#lastSequence = Math.max(
                this.#lastSequence,
                candidate.sequence
            );
        }
        if (nextStatus) this.#status = nextStatus;

        if (candidate.coalesceKey) {
            const index = this.#coalescedIndexes.get(candidate.coalesceKey);
            if (index !== undefined && this.#events[index]) {
                this.#events[index] = mergeCoalesced(
                    this.#events[index],
                    candidate
                );
                return true;
            }
        }

        this.#events.push(
            Object.freeze({
                ...candidate,
                payload: Object.freeze({ ...candidate.payload }),
            })
        );
        if (candidate.coalesceKey) {
            this.#coalescedIndexes.set(
                candidate.coalesceKey,
                this.#events.length - 1
            );
        }
        this.#trim();
        return true;
    }

    #trim(): void {
        while (this.#events.length > this.#maxEvents) {
            const removed = this.#events.shift();
            if (removed) this.#identities.delete(eventIdentity(removed));
        }
        this.#coalescedIndexes.clear();
        this.#events.forEach((event, index) => {
            if (event.coalesceKey) {
                this.#coalescedIndexes.set(event.coalesceKey, index);
            }
        });
    }
}
