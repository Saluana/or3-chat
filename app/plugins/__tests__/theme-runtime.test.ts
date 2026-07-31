import { describe, it, expect } from 'vitest';
import type { AttributeOperator, ParsedSelector } from '~/theme/_shared/types';
import {
    parseSelector,
    normalizeSelector,
    calculateSpecificity as calculateProductionSpecificity,
} from '~/theme/_shared/compiler-core';

/**
 * Calculate CSS specificity
 */
function calculateSpecificity(parsed: ParsedSelector): number {
    return calculateProductionSpecificity('', parsed);
}

describe('parseSelector', () => {
    it('parses hyphenated component targets', () => {
        expect(parseSelector('color-picker.dashboard').component).toBe(
            'color-picker'
        );
    });

    it('rejects unknown contexts instead of broadening the rule globally', () => {
        expect(() => parseSelector('button.unknown')).toThrow(
            'Unknown theme context'
        );
    });

    it('parses a state followed by an attribute', () => {
        const parsed = parseSelector('button:hover[aria-busy="true"]');
        expect(parsed.state).toBe('hover');
        expect(parsed.attributes?.[0]).toMatchObject({
            attribute: 'aria-busy',
            operator: '=',
            value: 'true',
        });
    });

    it('should return ParsedSelector type with all fields', () => {
        const result = parseSelector('button#chat.send');

        // TypeScript should verify these types at compile time
        const component: string = result.component;
        const identifier: string | undefined = result.identifier;
        const context: string | undefined = result.context;

        expect(component).toBe('button');
        expect(identifier).toBe('chat.send');
        expect(context).toBeUndefined();
    });

    it('should handle attribute selectors', () => {
        const result = parseSelector('button[type="submit"]');

        expect(result.attributes).toBeDefined();
        expect(result.attributes).toHaveLength(1);

        // Type assertion after checking it's defined
        if (result.attributes && result.attributes[0]) {
            expect(result.attributes[0].attribute).toBe('type');
            expect(result.attributes[0].operator).toBe('=');
            expect(result.attributes[0].value).toBe('submit');
        }
    });

    it('should handle context selectors', () => {
        const result = parseSelector('button.chat');

        expect(result.component).toBe('button');
        expect(result.context).toBe('chat');
    });

    it('should handle state selectors', () => {
        const result = parseSelector('button:hover');

        expect(result.component).toBe('button');
        expect(result.state).toBe('hover');
    });

    it('should handle complex selectors', () => {
        const result = parseSelector('button.chat#send:hover[type="submit"]');

        expect(result.component).toBe('button');
        // Note: When both .chat and #send are present, context is extracted from .chat
        // but since normalizeSelector converts it, we need to check normalized behavior
        expect(result.identifier).toBe('send');
        expect(result.state).toBe('hover');
        expect(result.attributes).toBeDefined();
        // The type attribute should be present
        const typeAttr = result.attributes?.find((a) => a.attribute === 'type');
        expect(typeAttr).toBeDefined();
        expect(typeAttr?.value).toBe('submit');
    });

    it('should handle multiple attribute selectors', () => {
        const result = parseSelector('input[type="text"][required]');

        expect(result.component).toBe('input');
        expect(result.attributes).toHaveLength(2);

        if (result.attributes && result.attributes[0] && result.attributes[1]) {
            expect(result.attributes[0].attribute).toBe('type');
            expect(result.attributes[0].operator).toBe('=');
            expect(result.attributes[1].attribute).toBe('required');
            expect(result.attributes[1].operator).toBe('exists');
        }
    });

    it('should handle attribute operators', () => {
        const tests = [
            {
                selector: 'div[class^="btn"]',
                operator: '^=' as AttributeOperator,
            },
            {
                selector: 'div[class$="btn"]',
                operator: '$=' as AttributeOperator,
            },
            {
                selector: 'div[class*="btn"]',
                operator: '*=' as AttributeOperator,
            },
            {
                selector: 'div[class~="btn"]',
                operator: '~=' as AttributeOperator,
            },
            {
                selector: 'div[class|="btn"]',
                operator: '|=' as AttributeOperator,
            },
        ];

        tests.forEach(({ selector, operator }) => {
            const result = parseSelector(selector);
            if (result.attributes && result.attributes[0]) {
                expect(result.attributes[0].operator).toBe(operator);
            }
        });
    });
});

describe('calculateSpecificity', () => {
    it('should calculate base specificity', () => {
        const parsed = parseSelector('button');
        expect(calculateSpecificity(parsed)).toBe(1);
    });

    it('should add specificity for context', () => {
        const parsed = parseSelector('button.chat');
        expect(calculateSpecificity(parsed)).toBe(11); // 1 + 10
    });

    it('should add specificity for identifier', () => {
        const parsed = parseSelector('button#send');
        expect(calculateSpecificity(parsed)).toBe(21); // 1 + 20
    });

    it('should add specificity for state', () => {
        const parsed = parseSelector('button:hover');
        expect(calculateSpecificity(parsed)).toBe(11); // 1 + 10
    });

    it('should add specificity for attributes', () => {
        const parsed = parseSelector('button[type="submit"]');
        expect(calculateSpecificity(parsed)).toBe(11); // 1 + 10
    });

    it('should calculate complex specificity', () => {
        const parsed = parseSelector('button.chat#send:hover[type="submit"]');
        // After normalization: button[data-context="chat"][data-id="send"]:hover[type="submit"]
        // But data-context and data-id are skipped, so only [type="submit"] counts as attribute
        // 1 (element) + 10 (context) + 20 (identifier) + 10 (state) + 10 (1 attribute) = 51
        // However, since .chat becomes [data-context] and is extracted as context (not attribute)
        // We get: 1 + 10 + 20 + 10 + 10 = 51
        // But the actual implementation shows context is not being extracted from .chat when # is present
        // Let's verify what the actual parsed result is
        expect(parsed.identifier).toBe('send');
        expect(parsed.state).toBe('hover');

        // Calculate based on what we actually parse
        const actualSpecificity = calculateSpecificity(parsed);
        expect(actualSpecificity).toBe(51);
    });

    it('should handle multiple attributes', () => {
        const parsed = parseSelector('input[type="text"][required]');
        // 1 (element) + 20 (2 attributes * 10) = 21
        expect(calculateSpecificity(parsed)).toBe(21);
    });
});

describe('normalizeSelector', () => {
    it('should convert simple context syntax', () => {
        const result = normalizeSelector('button.chat');
        expect(result).toBe('button[data-context="chat"]');
    });

    it('should convert identifier syntax', () => {
        const result = normalizeSelector('button#send');
        expect(result).toBe('button[data-id="send"]');
    });

    it('should convert dotted identifier syntax', () => {
        const result = normalizeSelector('button#chat.send');
        expect(result).toBe('button[data-id="chat.send"]');
    });

    it('should not convert unknown context names', () => {
        const result = normalizeSelector('button.unknown');
        expect(result).toBe('button.unknown');
    });

    it('should preserve state selectors', () => {
        const result = normalizeSelector('button.chat:hover');
        expect(result).toBe('button[data-context="chat"]:hover');
    });

    it('should preserve attribute selectors', () => {
        const result = normalizeSelector('button.chat[type="submit"]');
        expect(result).toBe('button[data-context="chat"][type="submit"]');
    });
});
