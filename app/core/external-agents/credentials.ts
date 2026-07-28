import type { ExternalAgentCredentialVault } from "./types";

class MemoryExternalAgentCredentialVault implements ExternalAgentCredentialVault {
  readonly #credentials = new Map<string, string>();

  async put(reference: string, secret: string): Promise<void> {
    const normalized = secret.trim();
    if (!reference.trim() || !normalized) {
      throw new Error("A credential reference and token are required");
    }
    this.#credentials.set(reference, normalized);
  }

  async resolve(reference: string): Promise<string | null> {
    return this.#credentials.get(reference) ?? null;
  }

  async remove(reference: string): Promise<void> {
    this.#credentials.delete(reference);
  }
}

type CredentialVaultGlobal = typeof globalThis & {
  __or3ExternalAgentCredentialVault?: ExternalAgentCredentialVault;
};

/**
 * Browser fallback for deployments without a native secure credential adapter.
 * Secrets stay in memory and are deliberately lost on a full page reload.
 */
export function getExternalAgentCredentialVault(): ExternalAgentCredentialVault {
  const scope = globalThis as CredentialVaultGlobal;
  return (
    scope.__or3ExternalAgentCredentialVault ??
    (scope.__or3ExternalAgentCredentialVault =
      new MemoryExternalAgentCredentialVault())
  );
}

export function registerExternalAgentCredentialVault(
  vault: ExternalAgentCredentialVault,
): () => void {
  const scope = globalThis as CredentialVaultGlobal;
  const previous = scope.__or3ExternalAgentCredentialVault;
  scope.__or3ExternalAgentCredentialVault = vault;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (scope.__or3ExternalAgentCredentialVault === vault) {
      scope.__or3ExternalAgentCredentialVault = previous;
    }
  };
}
