import { describe, expect, it } from "vitest";
import { classifyExternalAgentConversationLoadError } from "../recovery";

describe("external agent conversation recovery", () => {
  it.each([
    {
      name: "offline",
      input: {
        cause: new TypeError("Failed to fetch"),
        message: "Host could not be reached",
        connectionState: "offline" as const,
      },
      expected: "offline",
    },
    {
      name: "unauthorized",
      input: {
        cause: { statusCode: 401 },
        message: "Access token is unauthorized",
        connectionState: "online" as const,
      },
      expected: "credential",
    },
    {
      name: "stale host",
      input: {
        cause: { statusCode: 404 },
        message: "Trusted host was not found",
        connectionState: "online" as const,
      },
      expected: "stale_host",
    },
    {
      name: "transient server failure",
      input: {
        cause: { statusCode: 503 },
        message: "Service is temporarily unavailable",
        connectionState: "online" as const,
      },
      expected: "transient",
    },
  ])("maps $name to the right inline recovery", ({ input, expected }) => {
    expect(classifyExternalAgentConversationLoadError(input)).toBe(expected);
  });
});
