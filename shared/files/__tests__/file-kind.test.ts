import { describe, expect, it } from "vitest";
import {
  classifyFileBlob,
  classifyFileKind,
  DEFAULT_FILE_MIME_TYPE,
  hasSupportedRasterSignature,
} from "../file-kind";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const headers = {
  png: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  jpeg: bytes(0xff, 0xd8, 0xff, 0xe0),
  webp: bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50),
  gif: bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
};

describe("file-kind classification", () => {
  it("keeps PDF and supported raster MIME classifications", () => {
    expect(classifyFileKind("application/pdf")).toBe("pdf");
    expect(classifyFileKind("image/png")).toBe("image");
    expect(classifyFileKind("image/svg+xml")).toBe("file");
    expect(classifyFileKind("text/plain")).toBe("file");
  });

  it("requires the declared raster MIME to match its magic bytes", () => {
    expect(hasSupportedRasterSignature("image/png", headers.png)).toBe(true);
    expect(hasSupportedRasterSignature("image/jpeg", headers.jpeg)).toBe(true);
    expect(hasSupportedRasterSignature("image/webp", headers.webp)).toBe(true);
    expect(hasSupportedRasterSignature("image/gif", headers.gif)).toBe(true);
    expect(hasSupportedRasterSignature("image/jpeg", headers.png)).toBe(false);
    expect(hasSupportedRasterSignature("image/svg+xml", headers.png)).toBe(
      false,
    );
  });

  it("falls back to the inert generic kind for empty, unknown, and missing MIME files", async () => {
    await expect(
      classifyFileBlob(new Blob([], { type: "image/png" })),
    ).resolves.toEqual({ mimeType: "image/png", kind: "file" });
    await expect(
      classifyFileBlob(new Blob(["source"], { type: "text/html" })),
    ).resolves.toEqual({ mimeType: "text/html", kind: "file" });
    await expect(classifyFileBlob(new Blob(["bytes"]))).resolves.toEqual({
      mimeType: DEFAULT_FILE_MIME_TYPE,
      kind: "file",
    });
  });

  it("classifies a valid raster Blob before decoder dispatch", async () => {
    await expect(
      classifyFileBlob(new Blob([headers.png], { type: "image/png" })),
    ).resolves.toEqual({ mimeType: "image/png", kind: "image" });
    await expect(
      classifyFileBlob(new Blob([headers.gif], { type: "image/jpeg" })),
    ).resolves.toEqual({ mimeType: "image/jpeg", kind: "file" });
  });
});
