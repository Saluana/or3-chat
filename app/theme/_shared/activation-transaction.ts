export interface ThemeActivationTransaction {
    readonly revision: number;
    isCurrent(): boolean;
}

/**
 * Visual resources are shared when an activation re-applies the current theme
 * (for example during hydration). Releasing them in that case removes the
 * resources that were just preloaded for the target theme.
 */
export function shouldReleasePreviousThemeResources(
    previousTheme: string,
    targetTheme: string
): boolean {
    return previousTheme !== targetTheme;
}

/** Monotonic last-request-wins coordinator shared by async activation stages. */
export class ThemeActivationCoordinator {
    private revision = 0;

    begin(): ThemeActivationTransaction {
        const revision = ++this.revision;
        return Object.freeze({
            revision,
            isCurrent: () => revision === this.revision,
        });
    }

    supersede(): void {
        this.revision++;
    }
}
