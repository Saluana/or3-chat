/**
 * @module app/theme/_shared/compiler-core
 *
 * Purpose:
 * Parses theme selector DSL strings into structured components for matching.
 *
 * Behavior:
 * - Accepts shorthand and explicit context/identifier selectors
 * - Extracts component, context, identifier, state, and attribute matchers
 * - Caches parsed selectors for reuse
 *
 * Constraints:
 * - Parsing is intentionally shallow and does not validate full CSS grammar
 * - Only the DSL patterns used by OR3 are supported
 *
 * Non-Goals:
 * - Full CSS selector parsing
 * - Validation of component names or context existence
 */

import type {
    ParsedSelector,
    AttributeMatcher,
    AttributeOperator,
} from './types';
import { KNOWN_THEME_CONTEXTS } from './contexts';

/**
 * `parseSelector`
 *
 * Purpose:
 * Converts a selector string into a structured representation used by
 * runtime and build time override matching.
 *
 * Behavior:
 * - Parses shorthand and attribute syntax directly
 * - Returns cached results for repeated inputs
 *
 * Constraints:
 * - Rejects unsupported or ambiguous syntax instead of broadening its scope
 */
const selectorCache = new Map<string, ParsedSelector>();
const MAX_SELECTOR_CACHE_ENTRIES = 500;

export function parseSelector(selector: string): ParsedSelector {
    if (selectorCache.has(selector)) {
        return selectorCache.get(selector)!;
    }

    const input = selector.trim();
    const componentMatch = /^([a-zA-Z][\w-]*)/.exec(input);
    if (!componentMatch) {
        throw new Error(`Invalid theme selector "${selector}": component is required`);
    }

    const component = componentMatch[1]!.toLowerCase();
    let cursor = componentMatch[0].length;
    let context: string | undefined;
    let identifier: string | undefined;
    let state: string | undefined;
    const attributes: AttributeMatcher[] = [];

    while (cursor < input.length) {
        const remainder = input.slice(cursor);
        if (remainder.startsWith('.')) {
            const match = /^\.([a-zA-Z][\w-]*)/.exec(remainder);
            if (!match || context) {
                throw new Error(`Invalid theme selector "${selector}"`);
            }
            if (!(KNOWN_THEME_CONTEXTS as readonly string[]).includes(match[1]!)) {
                throw new Error(
                    `Unknown theme context "${match[1]}" in selector "${selector}"`
                );
            }
            context = match[1];
            cursor += match[0].length;
            continue;
        }
        if (remainder.startsWith('#')) {
            const match = /^#([\w.-]+)/.exec(remainder);
            if (!match || identifier) {
                throw new Error(`Invalid theme selector "${selector}"`);
            }
            identifier = match[1];
            cursor += match[0].length;
            continue;
        }
        if (remainder.startsWith(':')) {
            const match = /^:([a-zA-Z][\w-]*)/.exec(remainder);
            if (!match || state || remainder[match[0].length] === '(') {
                throw new Error(`Unsupported theme state in selector "${selector}"`);
            }
            state = match[1];
            cursor += match[0].length;
            continue;
        }
        if (remainder.startsWith('[')) {
            const match = /^\[([a-zA-Z][\w-]*)(?:([~|^$*]?=)"([^"]*)")?\]/.exec(
                remainder
            );
            if (!match) {
                throw new Error(`Invalid attribute selector in "${selector}"`);
            }
            const attribute = match[1]!;
            if (attribute === 'data-context') {
                if (context || !match[3]) throw new Error(`Invalid context in "${selector}"`);
                if (!(KNOWN_THEME_CONTEXTS as readonly string[]).includes(match[3])) {
                    throw new Error(`Unknown theme context "${match[3]}" in selector "${selector}"`);
                }
                context = match[3];
            } else if (attribute === 'data-id') {
                if (identifier || !match[3]) throw new Error(`Invalid identifier in "${selector}"`);
                identifier = match[3];
            } else {
                attributes.push({
                    attribute,
                    operator: (match[2] as AttributeOperator | undefined) ?? 'exists',
                    value: match[3],
                });
            }
            cursor += match[0].length;
            continue;
        }
        throw new Error(`Unsupported theme selector syntax near "${remainder}"`);
    }

    const result: ParsedSelector = {
        component,
        context,
        identifier,
        state,
        attributes: attributes.length > 0 ? attributes : undefined,
    };

    if (selectorCache.size >= MAX_SELECTOR_CACHE_ENTRIES) {
        const firstKey = selectorCache.keys().next().value;
        if (firstKey) {
            selectorCache.delete(firstKey);
        }
    }
    selectorCache.set(selector, result);
    return result;
}

/**
 * `calculateSpecificity`
 *
 * Purpose:
 * Computes a weighted specificity score for selector matching.
 *
 * Behavior:
 * - Treats context, identifier, attributes, and pseudo classes as weighted inputs
 *
 * Non-Goals:
 * - Exact parity with CSS specificity rules
 */
export function calculateSpecificity(
    _selector: string,
    parsed: ParsedSelector
): number {
    let specificity = 0;

    // Element: 1 point
    specificity += 1;

    // Context adds attribute specificity
    if (parsed.context) {
        specificity += 10;
    }

    // Identifier gets extra weight (it's also an attribute)
    if (parsed.identifier) {
        specificity += 20; // 10 for attribute + 10 extra
    }

    // Other HTML attributes: 10 points each
    if (parsed.attributes) {
        specificity += parsed.attributes.length * 10;
    }

    if (parsed.state) specificity += 10;

    return specificity;
}
