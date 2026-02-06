/**
 * @module app/core/sync/hlc
 *
 * Purpose:
 * Hybrid Logical Clock (HLC) utility for generating monotonic, globally-unique
 * timestamps used by the sync layer for ordering and conflict resolution.
 *
 * Format: `<timestamp_base36>:<counter_base36>:<nodeId>`
 * Example: `ks3n7x0g0:000:abc12345`
 *
 * Behavior:
 * - Combines wall clock time with a logical counter to ensure monotonicity
 *   even when multiple events occur in the same millisecond
 * - Node ID is persistent (stored in localStorage) and 8 chars long
 * - Lexicographic string comparison provides correct ordering
 *
 * Guarantees:
 * - Monotonically increasing per device
 * - Globally unique (with node ID)
 * - Lexicographically sortable
 * - Fixed-width padding ensures correct string comparison
 *
 * Constraints:
 * - Node ID uses `crypto.randomUUID()` truncated to 8 chars;
 *   collisions are possible but unlikely at small device counts
 * - Not NTP-synchronized; ordering is best-effort across devices
 *
 * @see core/sync/conflict-resolver for HLC-based tie-breaking
 * @see core/sync/hook-bridge for HLC generation on local writes
 */

/**
 * Purpose:
 * Generate monotonic HLC strings for ordering and conflict resolution.
 *
 * Behavior:
 * - Combines wall clock time with a logical counter
 * - Includes a stable node id so HLCs are globally unique
 *
 * Constraints:
 * - Not a time sync mechanism; cross-device ordering is best-effort
 */
export class HLCGenerator {
    private lastTimestamp = 0;
    private counter = 0;
    private nodeId: string | null = null;

    /**
     * Get or generate a persistent node/device ID
     */
    getNodeId(): string {
        if (this.nodeId) return this.nodeId;
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('or3-device-id');
            if (stored) {
                this.nodeId = stored;
                return this.nodeId;
            }
        }
        this.nodeId = crypto.randomUUID().slice(0, 8);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('or3-device-id', this.nodeId);
        }
        return this.nodeId;
    }

    /**
     * Generate a new HLC timestamp
     *
     * Guarantees:
     * - Monotonically increasing
     * - Globally unique (with node ID)
     * - Lexicographically sortable
     */
    generate(): string {
        const now = Date.now();
        if (now > this.lastTimestamp) {
            this.lastTimestamp = now;
            this.counter = 0;
        } else {
            this.counter++;
        }
        const ts = this.lastTimestamp.toString(36).padStart(9, '0');
        const cnt = this.counter.toString(36).padStart(3, '0');
        const node = this.getNodeId();
        return `${ts}:${cnt}:${node}`;
    }
}

let _instance: HLCGenerator | null = null;

/**
 * Purpose:
 * Return the process-wide HLC generator singleton.
 *
 * Constraints:
 * - Node id persistence uses `localStorage` when available (client)
 */
export function getHLCGenerator(): HLCGenerator {
    if (!_instance) _instance = new HLCGenerator();
    return _instance;
}

/**
 * Purpose:
 * Generate a new HLC string.
 *
 * Behavior:
 * - Delegates to the singleton generator
 */
export function generateHLC(): string {
    return getHLCGenerator().generate();
}

/**
 * Purpose:
 * Return the stable per-device node id used in HLC strings.
 */
export function getDeviceId(): string {
    return getHLCGenerator().getNodeId();
}

/**
 * Internal API.
 *
 * Purpose:
 * Reset the HLC singleton instance. Intended for tests.
 */
export function _resetHLC(): void {
    _instance = null;
}

/**
 * Purpose:
 * Parse an HLC string into its components.
 *
 * Constraints:
 * - Does not validate format strictly; invalid strings may produce defaults
 */
export function parseHLC(hlc: string): { timestamp: number; counter: number; nodeId: string } {
    const parts = hlc.split(':');
    return {
        timestamp: parseInt(parts[0] ?? '0', 36),
        counter: parseInt(parts[1] ?? '0', 36),
        nodeId: parts[2] ?? '',
    };
}

/**
 * Purpose:
 * Compare two HLC strings.
 *
 * Behavior:
 * - Uses lexicographic comparison because the string format is fixed-width padded
 */
export function compareHLC(a: string, b: string): number {
    // Lexicographic comparison works because of fixed-width padding
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/**
 * Purpose:
 * Derive an `order_key` value from an HLC string.
 *
 * Behavior:
 * - Currently the order key is the HLC itself
 *
 * Constraints:
 * - Keep this stable to avoid reordering synced messages
 */
export function hlcToOrderKey(hlc: string): string {
    return hlc;
}

/**
 * @deprecated Use _resetHLC instead
 */
export function _resetHLCState(): void {
    _resetHLC();
}
