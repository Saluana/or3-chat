/**
 * Canonical response policy for storage downloads.
 *
 * Client supplied MIME and disposition values are never trusted here. Only
 * legacy-safe raster images and PDFs may be served inline; every other file is
 * an inert attachment with an octet-stream content type.
 */
import type { FileKind } from "~~/shared/files/file-kind";
import {
  DEFAULT_FILE_MIME_TYPE,
  SUPPORTED_RASTER_MIME_TYPES,
  normalizeFileMimeType,
} from "~~/shared/files/file-kind";

export interface DownloadPolicyInput {
  fileKind?: FileKind;
  mimeType?: string;
  filename?: string;
  requestedDisposition?: "inline" | "attachment";
}

export interface DownloadPolicy {
  mimeType: string;
  disposition: "inline" | "attachment";
  filename: string;
}

const SAFE_INLINE_MIME_TYPES = new Set<string>([
  ...SUPPORTED_RASTER_MIME_TYPES,
  "application/pdf",
]);

function isSafeInlineType(
  fileKind: FileKind | undefined,
  mimeType: string,
): boolean {
  if (!SAFE_INLINE_MIME_TYPES.has(mimeType)) return false;
  if (fileKind === undefined) return true;
  if (fileKind === "pdf") return mimeType === "application/pdf";
  if (fileKind === "image") {
    return (SUPPORTED_RASTER_MIME_TYPES as readonly string[]).includes(
      mimeType,
    );
  }
  return false;
}

/** Sanitize a canonical name before passing it to a response header. */
export function sanitizeDownloadFilename(value: string | undefined): string {
  const sanitized = (typeof value === "string" ? value : "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[\\/]+/g, "_")
    .trim()
    .replace(/^\.+$/, "");
  return sanitized.slice(0, 180) || "download";
}

export function resolveDownloadPolicy(
  input: DownloadPolicyInput,
): DownloadPolicy {
  // Missing kind is retained for old metadata rows. Inference is restricted
  // to the exact legacy-safe MIME set, never arbitrary active content.
  const mimeType = normalizeFileMimeType(input.mimeType);
  const inline = isSafeInlineType(input.fileKind, mimeType);

  return {
    mimeType: inline ? mimeType : DEFAULT_FILE_MIME_TYPE,
    disposition:
      inline && input.requestedDisposition !== "attachment"
        ? "inline"
        : "attachment",
    filename: sanitizeDownloadFilename(input.filename),
  };
}
