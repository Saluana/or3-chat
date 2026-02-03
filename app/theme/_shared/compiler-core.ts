/**
 * @module app/theme/_shared/compiler-core
 *
 * Purpose:
 * Parses theme selector DSL strings into structured components for matching.
 *
 * Behavior:
 * - Normalizes shorthand selectors into attribute selectors
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
 * - Normalizes shorthand before parsing
 * - Returns cached results for repeated inputs
 *
 * Constraints:
 * - Returns a default component of "button" when no component is provided
 */
const selectorCache = new Map<string, ParsedSelector>();

export function parseSelector(selector: string): ParsedSelector {
    if (selectorCache.has(selector)) {
        return selectorCache.get(selector)!;
    }

    // Normalize simple syntax to attribute selectors
    const normalized = normalizeSelector(selector);

    // Extract component type (first word)
    const component = normalized.match(/^(\w+)/)?.[1] || 'button';

    // Extract data-context
    const context = normalized.match(/\[data-context="([^"]+)"\]/)?.[1];

    // Extract data-id
    const identifier = normalized.match(/\[data-id="([^"]+)"\]/)?.[1];

    // Extract pseudo-class state
    const state = normalized.match(/:(\w+)(?:\(|$)/)?.[1];

    // Extract HTML attribute selectors
    const attributes = extractAttributes(normalized);

    const result = {
        component,
        context,
        identifier,
        state,
        attributes: attributes.length > 0 ? attributes : undefined,
    };

    selectorCache.set(selector, result);
    return result;
}

/**
 * `escapeRegex`
 *
 * Purpose:
 * Escapes a string for safe regex construction in selector normalization.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `normalizeSelector`
 *
 * Purpose:
 * Expands shorthand selector syntax into attribute selectors.
 *
 * Behavior:
 * - Expands `#id` to `data-id` selectors
 * - Expands `.context` to `data-context` selectors for known contexts
 *
 * Constraints:
 * - Context expansion only applies to known contexts
 */
export function normalizeSelector(selector: string): string {
    let result = selector;

    // Convert #identifier to [data-id="identifier"] first to preserve dot-separated identifiers
     
    result = result.replace(/(\w+)#([\w.-]+)(?=[:\[]|$)/g, '$1[data-id="$2"]');

    // Convert .context to [data-context="context"] (after identifiers are normalized)
    for (const context of KNOWN_THEME_CONTEXTS) {
        const escapedContext = escapeRegex(context);
         
        const regex = new RegExp(
            '(\\w+)\\.' + escapedContext + '(?=[:\\[]|$)',
            'g'
        );
        result = result.replace(regex, `$1[data-context="${context}"]`);
    }

    return result;
}

/**
 * `extractAttributes`
 *
 * Purpose:
 * Extracts attribute matchers from a normalized selector string.
 *
 * Constraints:
 * - Ignores data-context and data-id which are handled separately
 */
function extractAttributes(selector: string): AttributeMatcher[] {
    const attributes: AttributeMatcher[] = [];
    // Match: [attribute] or [attribute="value"] or [attribute*="value"] etc.
    // Group 1: attribute name (without operator)
    // Group 2: full operator+value part (optional)
    // Group 3: operator (optional)
    // Group 4: value (optional)
    const attrRegex = /\[([a-zA-Z0-9-]+)([~|^$*]?=)?(?:"([^"]+)")?\]/g;
    let match;

    while ((match = attrRegex.exec(selector)) !== null) {
        const attrName = match[1];
        if (!attrName) continue;

        // Skip data-context and data-id (already handled)
        if (attrName === 'data-context' || attrName === 'data-id') continue;

        const hasOperator = match[2] !== undefined;
        const operator = hasOperator
            ? (match[2] as AttributeOperator)
            : ('exists' as AttributeOperator);
        const value = match[3];

        attributes.push({
            attribute: attrName,
            operator,
            value,
        });
    }

    return attributes;
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
    selector: string,
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

    // Pseudo-classes: 10 points each
    const pseudoCount = (selector.match(/:/g) || []).length;
    specificity += pseudoCount * 10;

    return specificity;
}
