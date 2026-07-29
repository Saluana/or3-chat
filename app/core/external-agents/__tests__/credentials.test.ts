import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BrowserExternalAgentCredentialVault } from "../credentials";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    values,
  };
}

const crypto = webcrypto as unknown as Crypto;

describe("BrowserExternalAgentCredentialVault", () => {
  it("keeps session-only credentials out of persistent storage", async () => {
    const local = storage();
    const vault = new BrowserExternalAgentCredentialVault({
      storage: local,
      crypto,
    });

    await vault.put("credential-1", "session-token");

    expect(await vault.resolve("credential-1")).toBe("session-token");
    expect(local.values.size).toBe(0);
    expect(
      await new BrowserExternalAgentCredentialVault({
        storage: local,
        crypto,
      }).resolve("credential-1"),
    ).toBeNull();
  });

  it("encrypts opted-in credentials and requires the PIN after reload", async () => {
    const local = storage();
    const vault = new BrowserExternalAgentCredentialVault({
      storage: local,
      crypto,
    });

    await vault.putPersistent(
      "credential-1",
      "or3-super-secret-token",
      "482915",
    );

    const serialized = [...local.values.values()].join("");
    expect(serialized).not.toContain("or3-super-secret-token");
    expect(serialized).not.toContain("482915");
    expect(vault.getStatus()).toMatchObject({
      configured: true,
      locked: false,
      persistedCredentialCount: 1,
    });

    const reloaded = new BrowserExternalAgentCredentialVault({
      storage: local,
      crypto,
    });
    expect(reloaded.getStatus().locked).toBe(true);
    expect(reloaded.hasPersistent("credential-1")).toBe(true);
    expect(reloaded.hasPersistent("credential-2")).toBe(false);
    expect(await reloaded.resolve("credential-1")).toBeNull();
    await expect(reloaded.unlock("000000")).rejects.toThrow("could not unlock");
    await reloaded.unlock("482915");
    expect(await reloaded.resolve("credential-1")).toBe(
      "or3-super-secret-token",
    );

    reloaded.lock();
    expect(await reloaded.resolve("credential-1")).toBeNull();
  });

  it("removes the encrypted vault when its last token is forgotten", async () => {
    const local = storage();
    const vault = new BrowserExternalAgentCredentialVault({
      storage: local,
      crypto,
    });
    await vault.putPersistent("credential-1", "token", "482915");

    await vault.remove("credential-1");

    expect(local.values.size).toBe(0);
    expect(vault.getStatus()).toMatchObject({
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    });
  });

  it("removes a stale persisted token when reconnecting session-only", async () => {
    const local = storage();
    const vault = new BrowserExternalAgentCredentialVault({
      storage: local,
      crypto,
    });
    await vault.putPersistent("credential-1", "old-token", "482915");

    await vault.put("credential-1", "new-session-token");

    expect(local.values.size).toBe(0);
    expect(await vault.resolve("credential-1")).toBe("new-session-token");
  });

  it("rejects weak PINs before writing anything", async () => {
    const local = storage();
    const vault = new BrowserExternalAgentCredentialVault({
      storage: local,
      crypto,
    });

    await expect(
      vault.putPersistent("credential-1", "token", "1234"),
    ).rejects.toThrow("at least 6 digits");
    expect(local.values.size).toBe(0);
  });
});
