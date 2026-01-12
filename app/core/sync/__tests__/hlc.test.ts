import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    compareHLC,
    generateHLC,
    getDeviceId,
    parseHLC,
    _resetHLCState,
} from '../hlc';

const fixedUuid = '11111111-1111-1111-1111-111111111111';

describe('HLC utility', () => {
    const originalCrypto = globalThis.crypto;

    beforeAll(() => {
        Object.defineProperty(globalThis, 'crypto', {
            value: { randomUUID: () => fixedUuid },
            configurable: true,
        });
    });

    afterAll(() => {
        Object.defineProperty(globalThis, 'crypto', {
            value: originalCrypto,
            configurable: true,
        });
    });

    beforeEach(() => {
        _resetHLCState();
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('increments counter when time does not advance', () => {
        let now = 1700000000000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);

        const first = generateHLC();
        const second = generateHLC();

        const parsedFirst = parseHLC(first);
        const parsedSecond = parseHLC(second);

        expect(parsedFirst.timestamp).toBe(now);
        expect(parsedSecond.timestamp).toBe(now);
        expect(parsedSecond.counter).toBe(parsedFirst.counter + 1);
        expect(compareHLC(first, second)).toBe(-1);
    });

    it('resets counter when wall clock advances', () => {
        let now = 1700000000000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);

        const first = generateHLC();
        now += 5000;
        const second = generateHLC();

        const parsedFirst = parseHLC(first);
        const parsedSecond = parseHLC(second);

        expect(parsedSecond.timestamp).toBeGreaterThan(parsedFirst.timestamp);
        expect(parsedSecond.counter).toBe(0);
        expect(compareHLC(first, second)).toBe(-1);
    });

    it('persists a stable device id per session', () => {
        const first = getDeviceId();
        const second = getDeviceId();
        expect(first).toBe(second);
        expect(first).toBe(fixedUuid.slice(0, 8));
    });
});
