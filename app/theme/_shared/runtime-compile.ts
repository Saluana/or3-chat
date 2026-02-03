/**
 * @module app/theme/_shared/runtime-compile
 *
 * Purpose:
 * Compiles override definitions into runtime friendly structures.
 *
 * Behavior:
 * - Parses selectors and computes specificity
 * - Sorts overrides by specificity descending
 *
 * Constraints:
 * - Only supports selector features implemented by compiler-core
 */

import type { CompiledOverride, OverrideProps } from './types';
import { parseSelector, calculateSpecificity } from './compiler-core';

/**
 * `compileOverridesRuntime`
 *
 * Purpose:
 * Compiles selector overrides for runtime resolution.
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
