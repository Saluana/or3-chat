import { describe, expect, it } from "vitest";
import { resolveDownloadPolicy } from "../download-policy";

describe("resolveDownloadPolicy", () => {
  it("preserves legacy image and PDF inline behavior", () => {
    expect(
      resolveDownloadPolicy({
        fileKind: "image",
        mimeType: "image/png",
        filename: "photo.png",
        requestedDisposition: "inline",
      }),
    ).toEqual({
      mimeType: "image/png",
      disposition: "inline",
      filename: "photo.png",
    });
    expect(
      resolveDownloadPolicy({
        fileKind: "pdf",
        mimeType: "application/pdf",
        filename: "brief.pdf",
      }).disposition,
    ).toBe("inline");
  });

  it("makes generic and active content inert", () => {
    const maliciousName = "../../evil" + String.fromCharCode(13, 10) + ".html";
    expect(
      resolveDownloadPolicy({
        fileKind: "file",
        mimeType: "text/html",
        filename: maliciousName,
        requestedDisposition: "inline",
      }),
    ).toEqual({
      mimeType: "application/octet-stream",
      disposition: "attachment",
      filename: ".._.._evil__.html",
    });
  });

  it("uses safe legacy inference only for exact supported types", () => {
    expect(resolveDownloadPolicy({ mimeType: "image/jpeg" }).mimeType).toBe(
      "image/jpeg",
    );
    expect(resolveDownloadPolicy({ mimeType: "image/svg+xml" })).toMatchObject({
      mimeType: "application/octet-stream",
      disposition: "attachment",
    });
  });
});
