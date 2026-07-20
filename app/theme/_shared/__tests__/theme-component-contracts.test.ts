import { describe, expect, it } from 'vitest';
import { APP_THEME_COMPONENT_KEYS, THEME_COMPONENT_CONTRACT_VERSION } from '../types';
import { THEME_COMPONENT_CONTRACTS } from '../theme-component-contracts';

describe('theme component contracts', () => {
    it('defines the current contract for every replaceable app surface', () => {
        expect(Object.keys(THEME_COMPONENT_CONTRACTS).sort()).toEqual(
            [...APP_THEME_COMPONENT_KEYS].sort()
        );
        for (const target of APP_THEME_COMPONENT_KEYS) {
            expect(THEME_COMPONENT_CONTRACTS[target]?.version).toBe(
                THEME_COMPONENT_CONTRACT_VERSION
            );
        }
    });
});
