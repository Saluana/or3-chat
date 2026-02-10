import type {
    ParsedSelector,
    AttributeMatcher,
    AttributeOperator,
} from './types';
import { KNOWN_THEME_CONTEXTS } from './contexts';

/**
 * Parse a selector into its components.
 */
const selectorCache = new Map<string, ParsedSelector>();
const MAX_SELECTOR_CACHE_ENTRIES = 200;

// Type guard for HMR support
interface HotModule {
    hot?: {
        dispose: (cb: () => void) => void;
    };
}

if ((import.meta as HotModule).hot) {
    (import.meta as HotModule).hot!.dispose(() => {
        selectorCache.clear();
    });
}

export function parseSelector(selector: string): ParsedSelector {
    if (selectorCache.has(selector)) {
        const cached = selectorCache.get(selector)!;
        selectorCache.delete(selector);
        selectorCache.set(selector, cached);
        return cached;
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
    if (selectorCache.size > MAX_SELECTOR_CACHE_ENTRIES) {
        const oldestKey = selectorCache.keys().next().value;
        if (oldestKey) {
            selectorCache.delete(oldestKey);
        }
    }
    return result;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize simple selector syntax to attribute selectors
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
 * Extract HTML attribute selectors from normalized selector
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
 * Calculate CSS selector specificity
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
