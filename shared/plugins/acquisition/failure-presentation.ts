import type { AcquisitionStatusView } from './contracts';

/** Requests can fail before an operation exists (expired session, denied access). */
export function acquisitionRequestError(error: unknown): string {
    const response = error as { statusCode?: number; status?: number } | null;
    const status = response?.statusCode ?? response?.status;
    if (status === 401) return 'Your session expired. Sign in again, then reopen this plugin before retrying.';
    if (status === 403) return 'This action needs administrator access. Sign in to system administration and check the target workspace.';
    if (status === 429) return 'Too many installation requests. Wait a moment before retrying.';
    return 'The server could not complete this request. Check Installed before retrying; ask the administrator to check the server logs if it continues.';
}

/** User copy is derived from codes, never from arbitrary exception text. */
export function acquisitionFailureHelp(view: AcquisitionStatusView) {
    const code = view.failure?.code;
    switch (code) {
        case 'already-installed':
            return { title: 'This version is already installed', message: 'A second copy is not needed. Open Installed to manage activation in your workspace.' };
        case 'grant-review-required':
            return { title: 'Permission approval is needed', message: 'Review this release’s permissions in the target workspace, then start the installation again.' };
        case 'setup-required':
            return { title: 'Finish plugin setup', message: 'Save the required settings or connections, then continue this installation.' };
        case 'client-canary-pending':
            return { title: 'Browser verification is pending', message: 'Continue in Chrome to check that the plugin can start safely.' };
        case 'registry-unreachable':
        case 'download-failed':
        case 'download-url-expired':
        case 'library-unavailable':
            return { title: 'The download could not finish', message: 'Check your connection and the marketplace service, then retry when available.' };
        case 'storage-unavailable':
        case 'download-over-limit':
            return { title: 'The server cannot store this package', message: 'Ask the instance administrator to check available disk space and package size limits.' };
        case 'link-expired':
        case 'coverage-required':
        case 'coverage-denied':
            return { title: 'Marketplace access needs attention', message: 'Open Library to reconnect your marketplace account or check access to this release.' };
        case 'package-verification-failed':
        case 'archive-digest-mismatch':
        case 'release-digest-mismatch':
        case 'release-metadata-invalid':
        case 'release-metadata-unsigned':
        case 'release-key-untrusted':
        case 'authority-mismatch':
        case 'advisory-unverified':
        case 'release-quarantined':
            return { title: 'Package safety checks did not pass', message: 'Do not bypass verification. Share the diagnostic report with the administrator or publisher so they can check the release.' };
        case 'pointer-conflict':
        case 'operation-conflict':
            return { title: 'The installation state changed', message: 'Check Installed for another completed installation or update before retrying.' };
        case 'workspace-preflight-blocked':
            return { title: 'Another workspace needs attention', message: 'An administrator must review the affected workspaces before this shared update can proceed.' };
        case 'health-check-failed':
            return { title: 'The plugin could not start safely', message: 'Share the diagnostic report with the publisher. Check Installed for the currently active version.' };
        default:
            return { title: 'Installation needs attention', message: 'Check Installed before trying again. Share the diagnostic report with the instance administrator to investigate this failure.' };
    }
}

/** Explicit allowlist: no exception message, URLs, tokens, user content or settings. */
export function acquisitionDiagnosticReport(
    view: AcquisitionStatusView,
    extra: {
        /** Observed runtime state, so support sees installed versus running. */
        readonly runtime?: {
            readonly state: string;
            readonly packageTreeSha256?: string | null;
            readonly workspaceId?: string | null;
            readonly degradedContributions?: readonly string[];
        };
        readonly activationTimedOut?: boolean;
    } = {}
) {
    return JSON.stringify({
        reportVersion: 1,
        operationId: boundString(view.operationId),
        pluginId: boundString(view.pluginId),
        version: boundString(view.version),
        workspaceId: boundString(view.workspaceId),
        status: view.status,
        stage: view.stage,
        failureCode: view.failure?.code ?? null,
        retryable: view.retryable,
        needsSetup: view.needsSetup,
        release: {
            releaseId: boundString(view.release.releaseId),
            archiveSha256: boundString(view.release.archiveSha256),
            packageTreeSha256: boundString(view.release.packageTreeSha256),
            manifestSha256: boundString(view.release.manifestSha256),
            authoritySha256: boundString(view.release.authoritySha256),
        },
        runtime: extra.runtime
            ? {
                  state: boundString(extra.runtime.state, 64),
                  packageTreeSha256: extra.runtime.packageTreeSha256
                      ? boundString(extra.runtime.packageTreeSha256)
                      : null,
                  workspaceId: extra.runtime.workspaceId
                      ? boundString(extra.runtime.workspaceId)
                      : null,
                  degradedContributions: (extra.runtime.degradedContributions ?? [])
                      .slice(0, 16)
                      .map((entry) => boundString(entry, 128)),
              }
            : null,
        activationTimedOut: extra.activationTimedOut ?? false,
        updatedAt: view.updatedAt,
    }, null, 2);
}

/** Diagnostic strings are bounded; over-long input is truncated, never dumped raw. */
export function boundString(value: string, maxLength = 256): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
}
