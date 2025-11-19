import type {
    CompiledOverride,
    OverrideProps,
    ParsedSelector,
    AttributeMatcher,
    AttributeOperator,
} from './types';
import { KNOWN_THEME_CONTEXTS } from './contexts';

/**
 * Compile override definitions into runtime-friendly structures.
 * Mirrors the build-time compiler but runs in the browser/server when themes
 * are dynamically loaded.
 */
export function compileOverridesRuntime(
    overrides: Record<string, OverrideProps>
): CompiledOverride[] {
    const compiled: CompiledOverride[] = [];

    for (const [selector, props] of Object.entries(overrides)) {
        const parsed = parseSelector(selector);
        const specificity = calculateSpecificity(parsed);

        compiled.push({
            component: parsed.component,
            context: parsed.context,
            identifier: parsed.identifier,
            state: parsed.state,
            attributes: parsed.attributes,
            props,
            selector,
            specificity,
        });
    }

    // Sort by specificity (descending)
    return compiled.sort((a, b) => b.specificity - a.specificity);
}

/**
 * Parse a selector into its components.
 */
const selectorCache = new Map<string, ParsedSelector>();

function parseSelector(selector: string): ParsedSelector {
    if (selectorCache.has(selector)) {
        return selectorCache.get(selector)!;
    }

    const normalized = normalizeSelector(selector);

    const component = normalized.match(/^(\w+)/)?.[1] || 'button';
    const context = normalized.match(/data-context="([^"]+)"/)?.[1];
    const identifier = normalized.match(/data-id="([^"]+)"/)?.[1];
    const state = normalized.match(/:(\w+)/)?.[1];

    const attributes: AttributeMatcher[] = [];
    const attributeRegex = /\[([\w-]+)(([~|^$*]=|=)"([^"]+)")?\]/g;
    let match: RegExpExecArray | null;

    while ((match = attributeRegex.exec(normalized)) !== null) {
        const attrName = match[1];
        if (
            !attrName ||
            attrName === 'data-context' ||
            attrName === 'data-id'
        ) {
            continue;
        }

        const fullMatch = match[2];
        let operator: AttributeOperator = 'exists';
        let attrValue: string | undefined;

        if (fullMatch) {
            const op = match[3];
            operator = op as AttributeOperator;
            attrValue = match[4];
        }

        attributes.push({
            attribute: attrName,
            operator,
            value: attrValue,
        });
    }

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
 * Normalize shorthand selector syntax to explicit attribute selectors.
 */
function normalizeSelector(selector: string): string {
    let result = selector;

    const knownContexts = KNOWN_THEME_CONTEXTS;
    // Normalize identifiers first so dot-separated identifiers aren't treated as contexts
    result = result.replace(/(\w+)#([\w.-]+)(?=[:\[]|$)/g, '$1[data-id="$2"]');

    const contextRegex = /(\w+)\.([\w-]+)(?=[:\[]|$)/g;
    result = result.replace(contextRegex, (match, component, context) => {
        if (knownContexts.includes(context)) {
            return `${component}[data-context="${context}"]`;
        }
        return match;
    });

    return result;
}

/**
 * Calculate specificity based on parsed selector parts.
 */
function calculateSpecificity(parsed: ParsedSelector): number {
    let specificity = 1; // element

    if (parsed.context) specificity += 10;
    if (parsed.identifier) specificity += 20;
    if (parsed.state) specificity += 10;
    if (parsed.attributes) specificity += parsed.attributes.length * 10;

    return specificity;
}
