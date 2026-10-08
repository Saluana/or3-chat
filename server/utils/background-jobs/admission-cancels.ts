/**
 * @module server/utils/background-jobs/admission-cancels
 *
 * Purpose:
 * Process-local cancellation markers for background admissions. A Stop request
 * can arrive before the job row is committed; the marker lets admission detect
 * and immediately abort the late job. TTL-bounded so stale entries do not
 * accumulate.
 *
 * Constraints:
 * - Process-local only. Multi-instance deployments may miss a marker written on
 *   another instance; the job-id cancellation path remains authoritative.
 */

const ADMISSION_CANCEL_TTL_MS = 10 * 60 * 1000;
const pendingAdmissionCancels = new Map<string, number>();

/** A caller's opaque ID cannot collide across users or originating workspaces. */
export function getScopedAdmissionKey(userId: string, workspaceId: string, admissionId: string): string {
    return JSON.stringify(['or3-admission-v1', userId, workspaceId, admissionId]);
}

export function markAdmissionCancelled(admissionId: string): void {
    pendingAdmissionCancels.set(
        admissionId,
        Date.now() + ADMISSION_CANCEL_TTL_MS
    );
}

export function hasAdmissionCancelled(admissionId: string): boolean {
    const expiresAt = pendingAdmissionCancels.get(admissionId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
        pendingAdmissionCancels.delete(admissionId);
        return false;
    }
    return true;
}
