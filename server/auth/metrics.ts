export interface AuthMetrics {
    sessionResolutions: number;
    sessionResolutionFailures: number;
    authorizationChecks: number;
    authorizationDenials: number;
    providerErrors: number;
}

const metrics: AuthMetrics = {
    sessionResolutions: 0,
    sessionResolutionFailures: 0,
    authorizationChecks: 0,
    authorizationDenials: 0,
    providerErrors: 0,
};

export function recordSessionResolution(success: boolean): void {
    if (success) {
        metrics.sessionResolutions++;
    } else {
        metrics.sessionResolutionFailures++;
    }
}

export function recordAuthorizationCheck(allowed: boolean): void {
    metrics.authorizationChecks++;
    if (!allowed) {
        metrics.authorizationDenials++;
    }
}

export function recordProviderError(): void {
    metrics.providerErrors++;
}

export function getMetrics(): Readonly<AuthMetrics> {
    return { ...metrics };
}

export function resetMetrics(): void {
    Object.keys(metrics).forEach(k => {
        metrics[k as keyof AuthMetrics] = 0;
    });
}
