import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../server/admin/auth/hash';

describe('Admin Auth - Password Hashing', () => {
    describe('hashPassword', () => {
        it('should hash a password', async () => {
            const password = 'TestPassword123';
            const hash = await hashPassword(password);
            
            expect(hash).toBeDefined();
            expect(hash).not.toBe(password);
            expect(hash.length).toBeGreaterThan(0);
            expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt hash format
        });

        it('should produce different hashes for the same password', async () => {
            const password = 'TestPassword123';
            const hash1 = await hashPassword(password);
            const hash2 = await hashPassword(password);
            
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('verifyPassword', () => {
        it('should verify correct password', async () => {
            const password = 'TestPassword123';
            const hash = await hashPassword(password);
            
            const isValid = await verifyPassword(password, hash);
            expect(isValid).toBe(true);
        });

        it('should reject incorrect password', async () => {
            const password = 'TestPassword123';
            const wrongPassword = 'WrongPassword456';
            const hash = await hashPassword(password);
            
            const isValid = await verifyPassword(wrongPassword, hash);
            expect(isValid).toBe(false);
        });

        it('should reject empty password', async () => {
            const password = 'TestPassword123';
            const hash = await hashPassword(password);
            
            const isValid = await verifyPassword('', hash);
            expect(isValid).toBe(false);
        });
    });

    describe('validatePasswordStrength', () => {
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
