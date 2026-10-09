/** SHA-256 for browsers, workers and servers, including HTTP LAN/Tailscale origins. */
export async function sha256Bytes(input: string | ArrayBuffer | ArrayBufferView): Promise<Uint8Array<ArrayBuffer>> {
    // Snapshot views before awaiting; honor offsets and normalize shared buffers.
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input)
        : input instanceof ArrayBuffer ? new Uint8Array(input.slice(0))
            : Uint8Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    const subtle = globalThis.crypto?.subtle;
    if (subtle) return new Uint8Array(await subtle.digest('SHA-256', bytes));
    const { sha256 } = await import('@noble/hashes/sha2.js');
    return Uint8Array.from(sha256(bytes));
}

export async function sha256Hex(input: string | ArrayBuffer | ArrayBufferView): Promise<string> {
    const bytes = await sha256Bytes(input);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
