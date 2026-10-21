/**
 * Canonical "what to run next" copy for CLI cheat sheets, review UI, and
 * the dev startup banner. Keep these strings in one place so docs and UX
 * don't drift.
 */
type PackageManager = 'npm' | 'bun';

export type NextStepsContext = {
    ssrAuthEnabled?: boolean;
    connectEnabled?: boolean;
    appUrl?: string;
    packageManager?: PackageManager;
};

/**
 * The one command that starts a source checkout. `dev` loads `.env`, so the
 * same command starts browser-only and authenticated setups. Setup copy, the
 * terminal cheat sheet and the wizard's local deploy all use it.
 */
export function startCommand(packageManager: PackageManager = 'npm'): {
    command: PackageManager;
    args: string[];
} {
    return { command: packageManager, args: ['run', 'dev'] };
}

export function formatStartCommand(packageManager: PackageManager = 'npm'): string {
    const { command, args } = startCommand(packageManager);
    return [command, ...args].join(' ');
}

const DEFAULT_APP_URL = 'http://localhost:3000';

export function resolveAppUrl(appUrl?: string): string {
    return (appUrl ?? DEFAULT_APP_URL).replace(/\/+$/, '');
}

/** Health check that includes provider/path/port checks. */
export const DOCTOR_COMMAND = 'npm run doctor';

/** Re-run / update cloud setup. */
export const WIZARD_INIT_COMMAND = 'npm run setup';

export function buildCheatSheetLines(context: NextStepsContext = {}): string[] {
    const appUrl = resolveAppUrl(context.appUrl);
    const packageManager = context.packageManager ?? 'npm';
    const lines = [
        `Start the app:    ${formatStartCommand(packageManager)}`,
        `Open:             ${appUrl}`,
    ];
    if (context.ssrAuthEnabled) {
        lines.push(`Admin dashboard:  ${appUrl}/admin`);
        lines.push(`Secret store:     first launch prompts for a local vault or manual attachment; ${packageManager} run setup:secrets to configure now`);
    }
    if (context.connectEnabled) {
        lines.push('Connect a computer: npx @or3/connect');
    }
    lines.push('Settings live in: .env');
    lines.push(`Re-run wizard:     ${packageManager} run setup`);
    lines.push(`Health check:      ${packageManager} run doctor`);
    return lines;
}

export function buildApplyOnlySuccessBody(
    connectEnabled = false,
    packageManager: PackageManager = 'npm'
): string {
    const connectMessage = connectEnabled
        ? ' After OR3 is running publicly, connect a computer with npx @or3/connect.'
        : '';
    return `Your .env and provider modules were written. Start the app with ${formatStartCommand(packageManager)} when you are ready. Authenticated source launches prompt for secret-store setup in the terminal; run ${packageManager} run setup:secrets to configure it first.${connectMessage}`;
}
