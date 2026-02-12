import { describe, it, expect } from 'vitest';
import {
    getAllowedMimeTypes,
    getMaxFileSizeBytes,
    isMimeTypeAllowed,
    validateFile,
    classifyKind,
} from '~/components/chat/file-upload-utils';

describe('file-upload-utils configuration', () => {
    describe('classifyKind', () => {
        it('should classify image MIME types', () => {
            expect(classifyKind('image/jpeg')).toBe('image');
            expect(classifyKind('image/png')).toBe('image');
            expect(classifyKind('image/webp')).toBe('image');
            expect(classifyKind('image/gif')).toBe('image');
        });

        it('should classify PDF MIME type', () => {
            expect(classifyKind('application/pdf')).toBe('pdf');
        });

        it('should return null for unsupported types', () => {
            expect(classifyKind('application/json')).toBe(null);
            expect(classifyKind('text/plain')).toBe(null);
            expect(classifyKind('video/mp4')).toBe(null);
        });
    });

    describe('getAllowedMimeTypes', () => {
        it('should return array of MIME types from config', () => {
            const allowed = getAllowedMimeTypes();
            expect(Array.isArray(allowed)).toBe(true);
            expect(allowed.length).toBeGreaterThan(0);
        });

        it('should filter empty strings', () => {
            const allowed = getAllowedMimeTypes();
            expect(allowed.every(m => m.length > 0)).toBe(true);
        });
    });

    describe('isMimeTypeAllowed', () => {
        it('should return true for allowed MIME types', () => {
            const allowed = getAllowedMimeTypes();
            // Test that at least some common types work
            for (const mime of allowed) {
                expect(isMimeTypeAllowed(mime)).toBe(true);
            }
        });

        it('should return false for clearly disallowed MIME types', () => {
            expect(isMimeTypeAllowed('application/json')).toBe(false);
            expect(isMimeTypeAllowed('text/plain')).toBe(false);
            expect(isMimeTypeAllowed('video/mp4')).toBe(false);
        });
    });

    describe('getMaxFileSizeBytes', () => {
        it('should return max file size', () => {
            const maxSize = getMaxFileSizeBytes();
            expect(typeof maxSize).toBe('number');
            expect(maxSize).toBeGreaterThan(0);
        });
    });

    describe('validateFile', () => {
        it('should accept valid files within size limit', () => {
            // Use a MIME type that should be in most configs
            const file = new File(['a'.repeat(1000)], 'test.jpg', {
                type: 'image/jpeg',
            });
            const result = validateFile(file);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.kind).toBe('image');
            }
        });

        it('should reject files that are too large', () => {
            // Create a file larger than the max size
            const largeContent = new Array(21 * 1024 * 1024).fill('a').join('');
            const file = new File([largeContent], 'large.jpg', {
                type: 'image/jpeg',
            });
            const result = validateFile(file);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe('ERR_FILE_VALIDATION');
                expect(result.message).toContain('too large');
            }
        });

        it('should reject unsupported MIME types', () => {
            const file = new File(['content'], 'test.json', {
                type: 'application/json', // Definitely not in the allowlist
            });
            const result = validateFile(file);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe('ERR_FILE_VALIDATION');
                expect(result.message).toBe('Unsupported file type');
            }
        });

        it('should accept PDF files if allowed', () => {
            const file = new File(['content'], 'test.pdf', {
                type: 'application/pdf',
            });
            const result = validateFile(file);
            // PDF should be in the default allowlist
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.kind).toBe('pdf');
            }
        });

        it('should reject files with empty/missing type', () => {
            const file = new File(['content'], 'test.unknown', {
                type: '',
            });
            const result = validateFile(file);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe('ERR_FILE_VALIDATION');
                expect(result.message).toBe('Unsupported file type');
            }
        });
    });
});
