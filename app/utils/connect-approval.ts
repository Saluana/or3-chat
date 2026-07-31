export function connectRequestRemainingSeconds(
  expiresAt: number | undefined,
  now = Date.now(),
): number {
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, Math.ceil((Number(expiresAt) - now) / 1_000));
}

export function formatConnectRequestCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function isExpiredConnectRequestError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    data?: {
      statusCode?: unknown;
      statusMessage?: unknown;
      message?: unknown;
    };
  };
  const status = Number(
    error.statusCode ?? error.status ?? error.data?.statusCode,
  );
  const message = String(
    error.data?.statusMessage ?? error.data?.message ?? error.message ?? "",
  ).toLowerCase();
  return (
    (status === 404 || status === 410) &&
    (message.includes("expired") ||
      message.includes("already used") ||
      message.includes("connection request"))
  );
}
