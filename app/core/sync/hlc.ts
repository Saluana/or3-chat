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

// State persisted across calls
let lastTimestamp = 0;
let counter = 0;
let nodeId: string | null = null;

/**
 * Get or generate a persistent node/device ID
 */
function getNodeId(): string {
    if (nodeId) return nodeId;

    // Try to get from localStorage
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('or3-device-id');
        if (stored) {
            nodeId = stored;
            return nodeId;
        }
    }

    // Generate new ID
    nodeId = crypto.randomUUID().slice(0, 8);

    // Persist it
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('or3-device-id', nodeId);
    }

    return nodeId;
}

/**
 * Generate a new HLC timestamp
 *
 * Guarantees:
 * - Monotonically increasing
 * - Globally unique (with node ID)
 * - Lexicographically sortable
 */
export function generateHLC(): string {
    const now = Date.now();

    if (now > lastTimestamp) {
        // Time has moved forward, reset counter
        lastTimestamp = now;
        counter = 0;
    } else {
        // Same or earlier time, increment counter
        counter++;
    }

    // Format: 13-digit timestamp : 4-digit counter : 8-char node ID
    const ts = lastTimestamp.toString().padStart(13, '0');
    const cnt = counter.toString().padStart(4, '0');
    const node = getNodeId();

    return `${ts}:${cnt}:${node}`;
}

/**
 * Parse an HLC string into components
 */
export function parseHLC(hlc: string): { timestamp: number; counter: number; nodeId: string } {
    const parts = hlc.split(':');
    return {
        timestamp: parseInt(parts[0] ?? '0', 10),
        counter: parseInt(parts[1] ?? '0', 10),
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
 * Get the current device ID
 */
export function getDeviceId(): string {
    return getNodeId();
}

/**
 * Derive an order_key from an HLC
 * Used for deterministic message ordering
 */
export function hlcToOrderKey(hlc: string): string {
    return hlc;
}

/**
 * Reset HLC state (for testing only)
 */
export function _resetHLCState(): void {
    lastTimestamp = 0;
    counter = 0;
}
