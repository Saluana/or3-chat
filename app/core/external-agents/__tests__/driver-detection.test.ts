import { describe, expect, it, vi } from "vitest";
import {
  createExternalAgentDriverDetector,
  type ExternalAgentDetectionFetch,
} from "../driver-detection";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("external agent driver detection", () => {
  it("detects the shared Runs surface", async () => {
    const fetch = vi.fn<ExternalAgentDetectionFetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer secret",
      );
      expect(init?.cache).toBe("no-store");
      return response({
        features: { session_resources: true, run_events_sse: true },
      });
    });

    await expect(
      createExternalAgentDriverDetector(fetch)({
        baseUrl: "https://agent.test",
        resolveCredential: async () => "secret",
      }),
    ).resolves.toBe("runs");
  });

  it("falls back to Intern when the Runs surface is absent", async () => {
    const fetch = vi.fn<ExternalAgentDetectionFetch>(async () =>
      response({ error: "not found" }, 404),
    );

    await expect(
      createExternalAgentDriverDetector(fetch)({
        baseUrl: "https://intern.test",
        resolveCredential: async () => "secret",
      }),
    ).resolves.toBe("intern");
  });

  it("does not treat null or malformed endpoint entries as Runs support", async () => {
    for (const endpoints of [
      { sessions: null, run_events: null },
      { sessions: false, run_events: { path: "events" } },
    ]) {
      const fetch = vi.fn<ExternalAgentDetectionFetch>(async () =>
        response({ endpoints }),
      );

      await expect(
        createExternalAgentDriverDetector(fetch)({
          baseUrl: "https://agent.test",
          resolveCredential: async () => "secret",
        }),
      ).resolves.toBe("intern");
    }
  });

  it("does not hide rejected credentials behind Intern fallback", async () => {
    const fetch = vi.fn<ExternalAgentDetectionFetch>(async () =>
      response({ error: "unauthorized" }, 401),
    );

    await expect(
      createExternalAgentDriverDetector(fetch)({
        baseUrl: "https://agent.test",
        resolveCredential: async () => "wrong",
      }),
    ).rejects.toThrow("rejected this access token");
  });
});
