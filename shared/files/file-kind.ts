/**
 * @module shared/files/file-kind
 *
 * Purpose:
 * Shared file-kind and MIME classification helpers for local file metadata.
 *
 * Behavior:
 * Keeps image/PDF metadata compatibility while treating every other file as
 * an inert generic file. Raster image processing is allowed only after the
 * declared MIME matches one of the supported formats and its magic bytes
 * match that format.
 *
 * Non-responsibilities:
 * - Does not validate cloud upload policy.
 * - Does not decode or fully parse media files.
 */

export const FILE_KINDS = ["image", "pdf", "file"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const SUPPORTED_RASTER_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type SupportedRasterMimeType =
  (typeof SUPPORTED_RASTER_MIME_TYPES)[number];

export const DEFAULT_FILE_MIME_TYPE = "application/octet-stream";

const RASTER_HEADER_BYTES = 12;

/** Normalize a declared MIME without turning parameters into an allowlist hit. */
export function normalizeFileMimeType(
  mimeType: string | null | undefined,
): string {
  const normalized =
    typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  return normalized || DEFAULT_FILE_MIME_TYPE;
}

export function isSupportedRasterMimeType(
  mimeType: string,
): mimeType is SupportedRasterMimeType {
  return (SUPPORTED_RASTER_MIME_TYPES as readonly string[]).includes(
    normalizeFileMimeType(mimeType),
  );
}

/** Classify a MIME declaration without treating arbitrary image/* as trusted. */
export function classifyFileKind(
  mimeType: string | null | undefined,
): FileKind {
  const normalized = normalizeFileMimeType(mimeType);
  if (normalized === "application/pdf") return "pdf";
  if (isSupportedRasterMimeType(normalized)) return "image";
  return "file";
}

function hasAsciiAt(
  header: Uint8Array,
  offset: number,
  value: string,
): boolean {
  if (header.length < offset + value.length) return false;
  for (let index = 0; index < value.length; index++) {
    if (header[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Check the short magic-byte signature required before raster decoding.
 * This is deliberately format-specific; a matching MIME declaration alone
 * is never enough to invoke an image decoder.
 */
export function hasSupportedRasterSignature(
  mimeType: string,
  header: Uint8Array,
): boolean {
  const normalized = normalizeFileMimeType(mimeType);
  if (!isSupportedRasterMimeType(normalized)) return false;

  switch (normalized) {
    case "image/png":
      return (
        header.length >= 8 &&
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47 &&
        header[4] === 0x0d &&
        header[5] === 0x0a &&
        header[6] === 0x1a &&
        header[7] === 0x0a
      );
    case "image/jpeg":
      return (
        header.length >= 3 &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff
      );
    case "image/webp":
      return (
        header.length >= 12 &&
        hasAsciiAt(header, 0, "RIFF") &&
        hasAsciiAt(header, 8, "WEBP")
      );
    case "image/gif":
      return hasAsciiAt(header, 0, "GIF87a") || hasAsciiAt(header, 0, "GIF89a");
    default:
      return false;
  }
}

/** Read only the bounded header needed to authorize raster processing. */
async function readBlobHeader(blob: Blob): Promise<Uint8Array> {
  const headerBlob = blob.slice(0, RASTER_HEADER_BYTES);
  const arrayBuffer = (
    headerBlob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  ).arrayBuffer;
  if (typeof arrayBuffer === "function") {
    const buffer = (await arrayBuffer.call(headerBlob)) as ArrayBuffer;
    return new Uint8Array(buffer);
  }

  if (typeof FileReader === "function") {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error("Unable to read file header"));
          return;
        }
        resolve(new Uint8Array(result));
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error("Unable to read file header"));
      reader.readAsArrayBuffer(headerBlob);
    });
  }

  throw new Error("Blob header reads are unavailable");
}

export async function hasSupportedRasterBlobSignature(
  blob: Blob,
  mimeType: string,
): Promise<boolean> {
  const normalized = normalizeFileMimeType(mimeType);
  if (!isSupportedRasterMimeType(normalized) || blob.size <= 0) return false;
  const header = await readBlobHeader(blob);
  return hasSupportedRasterSignature(normalized, header);
}

export interface FileClassification {
  mimeType: string;
  kind: FileKind;
}

/**
 * Classify a Blob for local metadata and decoder dispatch.
 * Read failures conservatively produce an inert generic file.
 */
export async function classifyFileBlob(
  blob: Blob,
): Promise<FileClassification> {
  const mimeType = normalizeFileMimeType(blob.type);
  if (mimeType === "application/pdf") {
    return { mimeType, kind: "pdf" };
  }

  if (isSupportedRasterMimeType(mimeType)) {
    try {
      if (await hasSupportedRasterBlobSignature(blob, mimeType)) {
        return { mimeType, kind: "image" };
      }
    } catch {
      // A bounded header read is best effort; do not invoke a decoder.
    }
  }

  return { mimeType, kind: "file" };
}
