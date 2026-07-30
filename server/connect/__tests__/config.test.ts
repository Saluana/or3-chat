import { describe, expect, it } from 'vitest';
import { parseConnectMaxComputers } from '../config';

describe('parseConnectMaxComputers', () => {
    it.each([
        undefined,
        null,
        '',
        ' ',
        'abc',
        'Infinity',
        Infinity,
        1.5,
        '1.5',
        0,
        -1,
        101,
        Number.MAX_SAFE_INTEGER + 1,
    ])('rejects invalid value %j', (value) => {
        expect(() => parseConnectMaxComputers(value)).toThrow(
            'OR3_CONNECT_MAX_COMPUTERS must be an integer between 1 and 100.'
        );
    });

    it.each([
        [1, 1],
        ['1', 1],
        [3, 3],
        ['100', 100],
    ])('accepts %j as %d', (value, expected) => {
        expect(parseConnectMaxComputers(value)).toBe(expected);
    });
});
