import { describe, expect, it } from 'vitest';
import * as uiMessages from '../uiMessages';

describe('uiMessages production surface', () => {
    it('does not expose a module-global raw conversation archive', () => {
        expect(uiMessages).not.toHaveProperty('recordRawMessage');
        expect(uiMessages).not.toHaveProperty('getRawMessages');
    });
});
