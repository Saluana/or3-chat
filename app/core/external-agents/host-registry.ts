import type { ExternalAgentHost } from "./types";

export function normalizeExternalAgentBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Host URL must use HTTP or HTTPS");
  }
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (parsed.protocol === "http:" && !loopback) {
    throw new Error(
      "Remote hosts must use HTTPS; HTTP is allowed only for loopback hosts",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "Host URL must not contain credentials, query parameters, or fragments",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function fallbackExternalAgentHostId(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return (
    parsed.host
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "or3-intern"
  );
}

export function sameExternalAgentEndpoint(
  left: string,
  right: string,
): boolean {
  try {
    return (
      normalizeExternalAgentBaseUrl(left) ===
      normalizeExternalAgentBaseUrl(right)
    );
  } catch {
    return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
  }
}

/**
 * Owns trusted host metadata and active-host selection. Credential secrets
 * remain isolated in ExternalAgentCredentialVault.
 */
export class ExternalAgentHostRegistry {
  #hosts: ExternalAgentHost[] = [];
  #activeHostId: string | null = null;

  get hosts(): readonly ExternalAgentHost[] {
    return this.#hosts;
  }

  get activeHostId(): string | null {
    return this.#activeHostId;
  }

  reset(
    hosts: readonly ExternalAgentHost[] = [],
    activeHostId: string | null = null,
  ): void {
    const unique = new Map(hosts.map((host) => [host.id, host] as const));
    this.#hosts = [...unique.values()];
    this.#activeHostId = unique.has(activeHostId ?? "") ? activeHostId : null;
  }

  replace(hosts: readonly ExternalAgentHost[]): void {
    const unique = new Map(hosts.map((host) => [host.id, host] as const));
    this.#hosts = [...unique.values()];
    if (!unique.has(this.#activeHostId ?? "")) this.#activeHostId = null;
  }

  setActive(hostId: string | null): void {
    this.#activeHostId =
      hostId === null || this.#hosts.some((host) => host.id === hostId)
        ? hostId
        : null;
  }

  find(hostId: string | null | undefined): ExternalAgentHost | undefined {
    return hostId
      ? this.#hosts.find((candidate) => candidate.id === hostId)
      : undefined;
  }

  findByEndpoint(baseUrl: string): ExternalAgentHost | undefined {
    return this.#hosts.find((candidate) =>
      sameExternalAgentEndpoint(candidate.baseUrl, baseUrl),
    );
  }
}
