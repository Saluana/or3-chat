import { presentExternalAgentError } from "./presentation";
import type { ExternalAgentDriverDetector } from "./types";

const DETECTION_TIMEOUT_MS = 5_000;

export type ExternalAgentDetectionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRunsCapabilities(value: unknown): boolean {
  const capabilities = record(value);
  const features = record(capabilities.features);
  const endpoints = record(capabilities.endpoints);
  const hasEndpoint = (name: string) => {
    const endpoint = record(endpoints[name]);
    return typeof endpoint.path === "string" && endpoint.path.trim().startsWith("/");
  };
  const sessions =
    features.session_resources === true || hasEndpoint("sessions");
  const events =
    features.run_events_sse === true || hasEndpoint("run_events");
  return sessions && events;
}

export function createExternalAgentDriverDetector(
  fetch: ExternalAgentDetectionFetch = globalThis.fetch.bind(globalThis),
): ExternalAgentDriverDetector {
  return async ({ baseUrl, resolveCredential }) => {
    const credential = await resolveCredential();
    if (!credential) throw new Error("An access token is required");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);
    try {
      const response = await fetch(new URL("v1/capabilities", `${baseUrl}/`), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${credential}`,
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("The agent service rejected this access token"), {
          status: response.status,
        });
      }
      if (!response.ok) return "intern";
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return "intern";
      }
      return isRunsCapabilities(body) ? "runs" : "intern";
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Agent service detection timed out");
      }
      if (
        error &&
        typeof error === "object" &&
        (Reflect.get(error, "status") === 401 ||
          Reflect.get(error, "status") === 403)
      ) {
        throw error;
      }
      // Intern hosts do not expose the Runs capability endpoint. Let their
      // existing health check produce the canonical connection result.
      const message = presentExternalAgentError(error, "").message;
      if (/invalid url|credentials/i.test(message)) throw error;
      return "intern";
    } finally {
      clearTimeout(timer);
    }
  };
}
