import type {
  ExternalAgentCredentialVault,
  ExternalAgentPinCredentialVault,
  ExternalAgentPinCredentialVaultStatus,
} from "./types";

const STORAGE_KEY = "or3.external-agents.credentials.v1";
const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const VERIFIER_TEXT = "or3-external-agent-vault-v1";
const VERIFIER_AAD = "or3-external-agent-vault-verifier";
const PIN_PATTERN = /^\d{6,}$/;

interface CredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface EncryptedCredential {
  readonly iv: string;
  readonly ciphertext: string;
}

interface StoredCredentialVault {
  readonly version: 1;
  readonly kdf: "PBKDF2-SHA-256";
  readonly iterations: number;
  readonly salt: string;
  readonly verifier: EncryptedCredential;
  readonly entries: Readonly<Record<string, EncryptedCredential>>;
}

function defaultStorage(): CredentialStorage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isEncryptedCredential(value: unknown): value is EncryptedCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.iv === "string" && typeof record.ciphertext === "string";
}

function parseStoredVault(value: string | null): StoredCredentialVault | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.version !== VAULT_VERSION ||
      parsed.kdf !== "PBKDF2-SHA-256" ||
      typeof parsed.iterations !== "number" ||
      !Number.isInteger(parsed.iterations) ||
      parsed.iterations < 100_000 ||
      parsed.iterations > 1_000_000 ||
      typeof parsed.salt !== "string" ||
      !isEncryptedCredential(parsed.verifier) ||
      !parsed.entries ||
      typeof parsed.entries !== "object" ||
      Array.isArray(parsed.entries)
    ) {
      return null;
    }
    const entries = Object.fromEntries(
      Object.entries(parsed.entries).filter((entry) =>
        isEncryptedCredential(entry[1]),
      ),
    );
    return {
      version: VAULT_VERSION,
      kdf: "PBKDF2-SHA-256",
      iterations: parsed.iterations,
      salt: parsed.salt,
      verifier: parsed.verifier,
      entries,
    };
  } catch {
    return null;
  }
}

function validatePin(pin: string): string {
  const normalized = pin.trim();
  if (!PIN_PATTERN.test(normalized)) {
    throw new Error("Use a PIN with at least 6 digits.");
  }
  return normalized;
}

function validateCredential(reference: string, secret: string) {
  const normalizedReference = reference.trim();
  const normalizedSecret = secret.trim();
  if (!normalizedReference || !normalizedSecret) {
    throw new Error("A credential reference and token are required");
  }
  return { reference: normalizedReference, secret: normalizedSecret };
}

export class BrowserExternalAgentCredentialVault implements ExternalAgentPinCredentialVault {
  readonly supportsPinPersistence = true as const;
  readonly #credentials = new Map<string, string>();
  readonly #storage: CredentialStorage | null;
  readonly #crypto: Crypto | null;
  #key: CryptoKey | null = null;

  constructor(
    options: {
      storage?: CredentialStorage | null;
      crypto?: Crypto | null;
    } = {},
  ) {
    this.#storage =
      options.storage === undefined ? defaultStorage() : options.storage;
    this.#crypto =
      options.crypto === undefined ? globalThis.crypto : options.crypto;
  }

  getStatus(): ExternalAgentPinCredentialVaultStatus {
    const vault = this.#read();
    return {
      supported: Boolean(this.#storage && this.#crypto?.subtle),
      configured: Boolean(vault),
      locked: Boolean(vault && !this.#key),
      persistedCredentialCount: Object.keys(vault?.entries ?? {}).length,
    };
  }

  async put(reference: string, secret: string): Promise<void> {
    const normalized = validateCredential(reference, secret);
    await this.remove(normalized.reference);
    this.#credentials.set(normalized.reference, normalized.secret);
  }

  async putPersistent(
    reference: string,
    secret: string,
    pin: string,
  ): Promise<void> {
    const normalized = validateCredential(reference, secret);
    const normalizedPin = validatePin(pin);
    const crypto = this.#requireCrypto();
    const storage = this.#requireStorage();
    let vault = this.#read();
    let key: CryptoKey;

    if (vault) {
      key = await this.#deriveAndVerify(vault, normalizedPin);
    } else {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await this.#deriveKey(normalizedPin, salt, PBKDF2_ITERATIONS);
      const verifier = await this.#encrypt(key, VERIFIER_TEXT, VERIFIER_AAD);
      vault = {
        version: VAULT_VERSION,
        kdf: "PBKDF2-SHA-256",
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64(salt),
        verifier,
        entries: {},
      };
    }

    const entry = await this.#encrypt(
      key,
      normalized.secret,
      normalized.reference,
    );
    const next: StoredCredentialVault = {
      ...vault,
      entries: {
        ...vault.entries,
        [normalized.reference]: entry,
      },
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.#key = key;
    this.#credentials.set(normalized.reference, normalized.secret);
  }

  async unlock(pin: string): Promise<void> {
    const vault = this.#read();
    if (!vault) throw new Error("No saved agent credentials were found.");
    this.#key = await this.#deriveAndVerify(vault, validatePin(pin));
  }

  lock(): void {
    this.#key = null;
    this.#credentials.clear();
  }

  async resolve(reference: string): Promise<string | null> {
    const normalizedReference = reference.trim();
    const memoryValue = this.#credentials.get(normalizedReference);
    if (memoryValue) return memoryValue;
    const vault = this.#read();
    const entry = vault?.entries[normalizedReference];
    if (!vault || !entry || !this.#key) return null;
    try {
      const secret = await this.#decrypt(this.#key, entry, normalizedReference);
      this.#credentials.set(normalizedReference, secret);
      return secret;
    } catch {
      return null;
    }
  }

  async remove(reference: string): Promise<void> {
    const normalizedReference = reference.trim();
    this.#credentials.delete(normalizedReference);
    const vault = this.#read();
    if (!vault || !vault.entries[normalizedReference]) return;
    const storage = this.#requireStorage();
    const entries = { ...vault.entries };
    delete entries[normalizedReference];
    if (!Object.keys(entries).length) {
      storage.removeItem(STORAGE_KEY);
      this.#key = null;
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...vault, entries }));
  }

  async #deriveAndVerify(
    vault: StoredCredentialVault,
    pin: string,
  ): Promise<CryptoKey> {
    try {
      const key = await this.#deriveKey(
        pin,
        base64ToBytes(vault.salt),
        vault.iterations,
      );
      const verifier = await this.#decrypt(key, vault.verifier, VERIFIER_AAD);
      if (verifier !== VERIFIER_TEXT) throw new Error("Invalid verifier");
      return key;
    } catch {
      throw new Error("That PIN could not unlock the saved agent token.");
    }
  }

  async #deriveKey(
    pin: string,
    salt: Uint8Array<ArrayBuffer>,
    iterations: number,
  ): Promise<CryptoKey> {
    const crypto = this.#requireCrypto();
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async #encrypt(
    key: CryptoKey,
    value: string,
    additionalData: string,
  ): Promise<EncryptedCredential> {
    const crypto = this.#requireCrypto();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(additionalData),
      },
      key,
      new TextEncoder().encode(value),
    );
    return {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  async #decrypt(
    key: CryptoKey,
    value: EncryptedCredential,
    additionalData: string,
  ): Promise<string> {
    const plaintext = await this.#requireCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(value.iv),
        additionalData: new TextEncoder().encode(additionalData),
      },
      key,
      base64ToBytes(value.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  }

  #read(): StoredCredentialVault | null {
    try {
      return parseStoredVault(this.#storage?.getItem(STORAGE_KEY) ?? null);
    } catch {
      return null;
    }
  }

  #requireCrypto(): Crypto {
    if (!this.#crypto?.subtle) {
      throw new Error("Encrypted credential storage is unavailable.");
    }
    return this.#crypto;
  }

  #requireStorage(): CredentialStorage {
    if (!this.#storage) {
      throw new Error("Persistent browser storage is unavailable.");
    }
    return this.#storage;
  }
}

export function isExternalAgentPinCredentialVault(
  vault: ExternalAgentCredentialVault,
): vault is ExternalAgentPinCredentialVault {
  return (
    "supportsPinPersistence" in vault && vault.supportsPinPersistence === true
  );
}

type CredentialVaultGlobal = typeof globalThis & {
  __or3ExternalAgentCredentialVault?: ExternalAgentCredentialVault;
};

/**
 * Browser fallback for deployments without a native secure credential adapter.
 * Session-only secrets stay in memory. Opted-in secrets are encrypted with a
 * PIN-derived key before being stored locally.
 */
export function getExternalAgentCredentialVault(): ExternalAgentCredentialVault {
  const scope = globalThis as CredentialVaultGlobal;
  return (
    scope.__or3ExternalAgentCredentialVault ??
    (scope.__or3ExternalAgentCredentialVault =
      new BrowserExternalAgentCredentialVault())
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
