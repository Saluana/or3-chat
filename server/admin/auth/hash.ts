/**
 * Password hashing utilities using bcryptjs.
 * Server-side only.
 */
import bcrypt from 'bcryptjs';

/**
 * Hash a password using bcrypt with cost factor 12.
 * @param password - Plain text password
 * @returns Bcrypt hash
 */
export async function hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a bcrypt hash.
 * @param password - Plain text password
 * @param hash - Bcrypt hash to compare against
 * @returns true if password matches
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

/**
 * Validate password strength.
 * Requirements:
 * - Min 12 characters
 * - At least one uppercase
 * - At least one lowercase
 * - At least one number
 * 
 * @param password - Password to validate
 * @returns Validation result
 */
export function validatePasswordStrength(password: string): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (password.length < 12) {
        errors.push('Password must be at least 12 characters long');
    }

    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
