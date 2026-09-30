import { describe, expect, it } from 'vitest';
import { satisfies, validRange } from 'semver';
import {
    isValidVersionRange,
    satisfiesVersionRange,
} from '../../packages/plugin-sdk/src/semver-range';

const versions = [
    '0.0.0',
    '0.3.0',
    '1.0.0',
    '1.2.3',
    '2.0.0',
    '2.1.0',
    '3.0.0',
    '2.0.0-beta.1',
    '2.5.7',
];

const ranges = [
    '*',
    '',
    '2.0.0',
    '^2.0.0',
    '~2.0.0',
    '^0.3.0',
    '>=1.2.3 <3.0.0',
    '2',
    '2.0',
    '2.x',
    '1.2.3 - 2.3.4',
    '^3.0.0',
    '~2.1.0',
    '>=2.0.0',
    '>2.0.0',
    '<=2.0.0',
    '<2.0.0',
    '1.x || >=2.5.0',
    '^0.0',
    '>=2.0.0-beta.0',
    'garbage',
    'latest',
];

describe('first-party semver range evaluator', () => {
    it('agrees with semver on range validity', () => {
        for (const range of ranges) {
            expect(
                isValidVersionRange(range),
                `validity of "${range}"`
            ).toBe(validRange(range) !== null);
        }
    });

    it('agrees with semver on version satisfaction', () => {
        for (const range of ranges) {
            if (validRange(range) === null) continue;
            for (const version of versions) {
                expect(
                    satisfiesVersionRange(version, range),
                    `"${version}" in "${range}"`
                ).toBe(satisfies(version, range));
            }
        }
    });
});
