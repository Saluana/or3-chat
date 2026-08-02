import { describe, expect, it } from "vitest";
import { parseExternalAgentPersistence } from "../persistence";
import { externalAgentDriver } from "../types";

const host = {
  id: "host-1",
  name: "Agent service",
  baseUrl: "https://agent.test",
  credentialRef: "credential-1",
  trustedAt: "2026-08-01T00:00:00.000Z",
};

describe("external agent persistence", () => {
  it("loads legacy hosts as Intern hosts without rewriting them", () => {
    const parsed = parseExternalAgentPersistence({
      hosts: [host],
      activeHostId: host.id,
      sessionRefs: [],
    });

    expect(parsed.hosts).toEqual([host]);
    expect(externalAgentDriver(parsed.hosts[0]!)).toBe("intern");
  });

  it.each(["intern", "runs"] as const)("preserves the %s driver", (driver) => {
      const parsed = parseExternalAgentPersistence({
        hosts: [{ ...host, driver }],
        activeHostId: host.id,
        sessionRefs: [],
      });

      expect(parsed.hosts[0]).toEqual({ ...host, driver });
      expect(externalAgentDriver(parsed.hosts[0]!)).toBe(driver);
  });

  it("drops hosts with an unknown driver and clears their active reference", () => {
    const parsed = parseExternalAgentPersistence({
      hosts: [{ ...host, driver: "openclaw" }],
      activeHostId: host.id,
      sessionRefs: [],
    });

    expect(parsed.hosts).toEqual([]);
    expect(parsed.activeHostId).toBeNull();
  });

  it("restores session model, reasoning, and an active turn", () => {
    const parsed = parseExternalAgentPersistence({
      hosts: [{ ...host, driver: "runs" }],
      activeHostId: host.id,
      sessionRefs: [
        {
          hostId: host.id,
          remoteSessionId: "session-1",
          model: "openai/gpt-5",
          thinkingLevel: "high",
          activeTurnId: "run-1",
          status: "running",
        },
      ],
    });

    expect(parsed.sessionRefs[0]).toMatchObject({
      model: "openai/gpt-5",
      thinkingLevel: "high",
      activeTurnId: "run-1",
      status: "running",
    });
  });
});
