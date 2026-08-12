export type ReleaseVersionContract = {
    requested: string;
    root: string;
    lock: string | undefined;
    lockRoot: string | undefined;
    cloud: string;
    cli: string | undefined;
};

export function assertReleaseVersionContract(contract: ReleaseVersionContract): void {
    if (!/^\d+\.\d+\.\d+$/.test(contract.requested)) {
        throw new Error(`Release version must be an exact stable semantic version, got ${contract.requested}.`);
    }
    const mismatches = Object.entries(contract)
        .filter(([key]) => key !== 'requested')
        .filter(([, value]) => value !== contract.requested)
        .map(([key, value]) => `${key}=${value ?? 'missing'}`);
    if (mismatches.length) {
        throw new Error(`Release version ${contract.requested} is not aligned: ${mismatches.join(', ')}.`);
    }
}

export function isRegistryNotFound(output: string): boolean {
    return /\bE404\b|\b404 Not Found\b|manifest unknown|name unknown|no such manifest/i.test(output);
}

export function assertCleanStatus(status: string): void {
    if (status.trim()) {
        throw new Error(`Release preparation requires a clean isolated worktree. Dirty entries:\n${status.trim()}`);
    }
}
