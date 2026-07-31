import { describe, expect, it } from "vitest";
import {
  connectRequestRemainingSeconds,
  formatConnectRequestCountdown,
  isExpiredConnectRequestError,
} from "../connect-approval";

describe("Connect approval expiry", () => {
  it("counts down without displaying a request past its deadline", () => {
    expect(connectRequestRemainingSeconds(160_001, 100_000)).toBe(61);
    expect(connectRequestRemainingSeconds(100_000, 100_000)).toBe(0);
    expect(connectRequestRemainingSeconds(99_999, 100_000)).toBe(0);
    expect(formatConnectRequestCountdown(61)).toBe("1:01");
  });

  it("recognizes terminal lookup and approval expiry responses", () => {
    expect(
      isExpiredConnectRequestError({
        statusCode: 404,
        data: {
          statusMessage:
            "This connection request expired or was already used.",
        },
      }),
    ).toBe(true);
    expect(
      isExpiredConnectRequestError({
        statusCode: 503,
        data: { statusMessage: "Temporarily unavailable." },
      }),
    ).toBe(false);
  });
});
