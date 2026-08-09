import { describe, expect, it } from 'vitest';
import { createWizardValidationIssues } from '../validation-issues';

describe('wizard validation issues', () => {
    it('assigns stable field and step identifiers without client-side matching', () => {
        expect(
            createWizardValidationIssues([
                'OR3_STORAGE_S3_BUCKET is required for s3 storage.',
                'SSR_AUTH_ENABLED must be true for the selected provider.',
                'An unclassified configuration error.',
            ]),
        ).toEqual([
            {
                message: 'OR3_STORAGE_S3_BUCKET is required for s3 storage.',
                field: 's3Bucket',
                stepId: 'provider-storage',
            },
            {
                message: 'SSR_AUTH_ENABLED must be true for the selected provider.',
                stepId: 'providers',
            },
            { message: 'An unclassified configuration error.' },
        ]);
    });
});
