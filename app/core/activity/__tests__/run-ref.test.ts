import { describe, expect, it } from 'vitest';
import {
    decodeActivityRunRef,
    encodeActivityRunRef,
} from '../run-ref';

describe('Activity run references', () => {
    it('round trips opaque source and run IDs', () => {
        const input = { sourceId: 'or3.workflow', runId: 'message:/? one' };
        expect(decodeActivityRunRef(encodeActivityRunRef(input))).toEqual(
            input
        );
    });

    it('rejects malformed references', () => {
        expect(decodeActivityRunRef(null)).toBeNull();
        expect(decodeActivityRunRef('bad')).toBeNull();
        expect(
            decodeActivityRunRef(
                encodeURIComponent(JSON.stringify(['only-one']))
            )
        ).toBeNull();
    });
});

