/**
 * Hybrid Logical Clock (HLC) Utility
 *
 * Generates monotonic, globally-unique timestamps for sync operations.
 * Combines wall clock time with a logical counter to ensure ordering
 * even when wall clocks skew or multiple events occur in the same millisecond.
 *
 * Format: <timestamp>:<counter>:<nodeId>
 * Example: 1736648823456:0003:abc12345
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

export function getHLCGenerator(): HLCGenerator {
    if (!_instance) _instance = new HLCGenerator();
    return _instance;
}

export function generateHLC(): string {
    return getHLCGenerator().generate();
}

export function getDeviceId(): string {
    return getHLCGenerator().getNodeId();
}

export function _resetHLC(): void {
    _instance = null;
}

/**
 * Parse an HLC string into components
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
 * Compare two HLC strings
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareHLC(a: string, b: string): number {
    // Lexicographic comparison works because of fixed-width padding
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/**
 * Derive an order_key from an HLC
 * Used for deterministic message ordering
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
