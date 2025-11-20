import type {
    CompiledOverride,
    OverrideProps,
    ParsedSelector,
    AttributeMatcher,
    AttributeOperator,
} from './types';
import {
    parseSelector,
    calculateSpecificity,
} from './compiler-core';

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
        const specificity = calculateSpecificity(selector, parsed);

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


