import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../server/admin/auth/hash';
import { ADMIN_PASSWORD_POLICY_VECTORS } from '../../shared/cloud/wizard/admin-password-policy-vectors';

describe('Admin Auth - Password Hashing', () => {
    it('hashes once and verifies correct and incorrect passwords', async () => {
        const password = 'TestPassword123';
        const hash = await hashPassword(password);

        expect(hash).not.toBe(password);
        expect(hash).toMatch(/^\$2[aby]\$/);
        await expect(verifyPassword(password, hash)).resolves.toBe(true);
        await expect(verifyPassword('WrongPassword456', hash)).resolves.toBe(false);
    });

    describe('validatePasswordStrength', () => {
        it('uses the canonical policy vectors', () => {
            for (const vector of ADMIN_PASSWORD_POLICY_VECTORS) {
                expect(validatePasswordStrength(vector.value).valid).toBe(vector.valid);
            }
        });

        it('should accept strong password', () => {
            const result = validatePasswordStrength('TestPassword123');
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject password less than 12 characters', () => {
            const result = validatePasswordStrength('Short1A');
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must be at least 12 characters long');
        });

        it('should reject password without uppercase', () => {
            const result = validatePasswordStrength('testpassword123');
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
        });

        it('should reject password without lowercase', () => {
            const result = validatePasswordStrength('TESTPASSWORD123');
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one lowercase letter');
        });

        it('should reject password without number', () => {
            const result = validatePasswordStrength('TestPasswordABC');
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one number');
        });

        it('should return multiple errors for weak password', () => {
            const result = validatePasswordStrength('weak');
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(1);
        });
    });
});
