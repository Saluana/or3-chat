export interface StorageReferenceContractAdapter {
    name: string;
    put(hash: string): Promise<void>;
    reference(hash: string): Promise<void>;
    collect(): Promise<readonly string[]>;
}

export interface TransferLeaseContractAdapter {
    name: string;
    enqueue(id: string): Promise<void>;
    claim(workerId: string, now: number): Promise<string | null>;
    expire(id: string, now: number): Promise<void>;
}

/** Live references must dominate retention age and provider listing order. */
export async function verifyStorageReferenceContract(
    adapter: StorageReferenceContractAdapter
): Promise<void> {
    await adapter.put('live');
    await adapter.put('orphan');
    await adapter.reference('live');
    const deleted = await adapter.collect();
    if (deleted.includes('live') || !deleted.includes('orphan')) {
        throw new Error(`${adapter.name} violated canonical reference liveness`);
    }
}

/** Exactly one worker owns a live lease; an expired lease is recoverable. */
export async function verifyTransferLeaseContract(
    adapter: TransferLeaseContractAdapter
): Promise<void> {
    await adapter.enqueue('transfer-1');
    const [first, second] = await Promise.all([
        adapter.claim('worker-a', 100),
        adapter.claim('worker-b', 100),
    ]);
    if ([first, second].filter(Boolean).length !== 1) {
        throw new Error(`${adapter.name} allowed a duplicate active transfer claim`);
    }
    await adapter.expire('transfer-1', 200);
    const recovered = await adapter.claim('worker-c', 201);
    if (recovered !== 'transfer-1') {
        throw new Error(`${adapter.name} did not recover an expired transfer lease`);
    }
}
