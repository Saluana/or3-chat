export interface ThemeActivationTransaction {
    readonly revision: number;
    isCurrent(): boolean;
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
