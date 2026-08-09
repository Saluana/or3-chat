/**
 * @module shared/cloud/wizard/admin-dashboard
 *
 * Shared policy helpers for the SSR admin dashboard credentials.
 * These helpers are intentionally runtime-agnostic so both the Bun CLI
 * and the browser wizard can use the same rules and generators.
 */

export const ADMIN_USERNAME_MIN_LENGTH = 3;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALL_PASSWORD_CHARS = `${UPPERCASE}${LOWERCASE}${DIGITS}-_`;

export type AdminPasswordPolicyFailure =
    | 'minLength'
    | 'uppercase'
    | 'lowercase'
    | 'number';

function randomIndex(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Random selection limit must be a positive integer.');
    }

    const range = 0x1_0000_0000;
    const threshold = range - (range % limit);
    const bytes = new Uint32Array(1);
    do {
        globalThis.crypto.getRandomValues(bytes);
    } while (bytes[0]! >= threshold);
    return bytes[0]! % limit;
}

function pickRandomChar(alphabet: string): string {
    return alphabet[randomIndex(alphabet.length)] ?? alphabet[0]!;
}

function shuffleInPlace(items: string[]): void {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swapIndex = randomIndex(index + 1);
        [items[index], items[swapIndex]] = [items[swapIndex]!, items[index]!];
    }
}

export function getAdminPasswordPolicyFailures(
    password: string
): AdminPasswordPolicyFailure[] {
    const failures: AdminPasswordPolicyFailure[] = [];
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
        failures.push('minLength');
    }
    if (!/[A-Z]/.test(password)) {
        failures.push('uppercase');
    }
    if (!/[a-z]/.test(password)) {
        failures.push('lowercase');
    }
    if (!/[0-9]/.test(password)) {
        failures.push('number');
    }
    return failures;
}

export function formatAdminPasswordPolicyFailure(
    failure: AdminPasswordPolicyFailure,
    input: {
        label: string;
        verb: 'must' | 'should';
    }
): string {
    const { label, verb } = input;
    if (failure === 'minLength') {
        return `${label} ${verb} be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`;
    }
    if (failure === 'uppercase') {
        return `${label} ${verb} contain at least one uppercase letter.`;
    }
    if (failure === 'lowercase') {
        return `${label} ${verb} contain at least one lowercase letter.`;
    }
    return `${label} ${verb} contain at least one number.`;
}

export function generateAdminPassword(length = 24): string {
    const safeLength = Math.max(
        ADMIN_PASSWORD_MIN_LENGTH,
        Math.trunc(length)
    );
    const chars: string[] = [
        pickRandomChar(UPPERCASE),
        pickRandomChar(LOWERCASE),
        pickRandomChar(DIGITS),
    ];

    while (chars.length < safeLength) {
        chars.push(pickRandomChar(ALL_PASSWORD_CHARS));
    }

    shuffleInPlace(chars);
    return chars.join('');
}
