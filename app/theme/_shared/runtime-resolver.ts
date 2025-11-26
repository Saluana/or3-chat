/**
 * Runtime Override Resolver
 *
 * This class is responsible for resolving theme overrides at runtime.
 * It matches component parameters against compiled overrides and merges
 * them by specificity.
 *
 * Performance targets:
 * - Override resolution: < 1ms per component
 * - Theme switch: < 50ms total
 */

import type {
    CompiledOverride,
    CompiledTheme,
    AttributeMatcher,
    PropClassMaps,
} from './types';

/**
 * Parameters for resolving overrides
 */
export interface ResolveParams {
    /** Component type (e.g., 'button', 'input', 'modal') */
    component: string;

    /** Context name (e.g., 'chat', 'sidebar', 'dashboard') */
    context?: string;

    /** Theme identifier (e.g., 'chat.send', 'search.query') */
    identifier?: string;

    /** Component state (e.g., 'hover', 'active', 'focus') */
    state?: string;

    /** HTML element for attribute matching */
    element?: HTMLElement;

    /** Whether component is a Nuxt UI component (for prop mapping) */
    isNuxtUI?: boolean;
}

/**
 * Resolved override result
 */
export interface ResolvedOverride {
    /** Merged props to apply to component */
    props: Record<string, unknown>;
}

/**
 * Simple LRU Cache implementation for override resolution.
 * Limits memory usage by evicting least recently used entries.
 *
 * Note: This LRU implementation treats Map insertion order as access order.
 * When a key is accessed or set, it is deleted and re-inserted to move it to the end of the Map,
 * representing the most recently used position. This is a non-standard LRU approach; typical LRU caches
 * maintain a separate order-tracking structure.
 */
class LRUCache<K, V> {
    private cache: Map<K, V>;
    private readonly maxSize: number;

    constructor(maxSize: number = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        // Delete if exists to re-insert at end
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest only for new keys
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, value);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

/**
 * Runtime resolver for theme overrides
 *
 * The resolver is initialized with a compiled theme configuration
 * and provides efficient override resolution based on component parameters.
 */
export class RuntimeResolver {
    private overrides: CompiledOverride[]; // Keep reference for tests
    private overrideIndex: Map<string, CompiledOverride[]>;
    private propMaps: PropClassMaps;
    private themeName: string;
    private cache: LRUCache<string, ResolvedOverride>;
    private componentsWithAttributes: Set<string>;

    /**
     * Create a new runtime resolver
     *
     * @param compiledTheme - Compiled theme configuration from build time
     */
    constructor(compiledTheme: CompiledTheme) {
        // Build index by component type for fast lookup
        // Overrides should already be sorted by specificity in the compiled theme
        // but we sort here for safety and to maintain test compatibility
        this.overrides = [...compiledTheme.overrides].sort(
            (a, b) => b.specificity - a.specificity
        );

        this.overrideIndex = new Map();
        this.componentsWithAttributes = new Set();

        for (const override of this.overrides) {
            const key = override.component;
            if (!this.overrideIndex.has(key)) {
                this.overrideIndex.set(key, []);
            }
            this.overrideIndex.get(key)!.push(override);

            if (override.attributes && override.attributes.length > 0) {
                this.componentsWithAttributes.add(key);
            }
        }

        // Store prop-to-class mappings (merge with defaults)
        this.propMaps = {
            ...defaultPropMaps,
            ...(compiledTheme.propMaps || {}),
        };
        this.themeName = compiledTheme.name;
        // Use LRU cache with max 100 entries to limit memory usage
        this.cache = new LRUCache(100);
    }

    /**
     * Resolve overrides for a component instance
     *
     * Matches component parameters against compiled overrides and merges
     * by specificity. Returns merged props ready to apply to component.
     *
     * @param params - Component parameters for resolution
     * @returns Resolved override props
     */
    resolve(params: ResolveParams): ResolvedOverride {
        // Check cache first
        // We can cache if:
        // 1. No element is provided OR
        // 2. Element is provided but this component type has no attribute-dependent overrides
        const canCache =
            !params.element ||
            !this.componentsWithAttributes.has(params.component);
        let cacheKey: string | undefined;

        if (canCache) {
            cacheKey = this.getCacheKey(params);
            const cached = this.cache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            // Find all matching overrides using the index
            const matching: CompiledOverride[] = [];

            // Only check overrides for this component type
            const candidates = this.overrideIndex.get(params.component) || [];

            for (const override of candidates) {
                if (this.matches(override, params)) {
                    matching.push(override);
                }
            }

            // Merge matching overrides by specificity
            const merged = this.merge(matching);

            if (import.meta.dev) {
                const fallbackSelectors: string[] = [];
                if (params.identifier) {
                    fallbackSelectors.push(
                        `${params.component}#${params.identifier}`
                    );
                }
                if (params.context) {
                    fallbackSelectors.push(
                        `${params.component}.${params.context}`
                    );
                }
                fallbackSelectors.push(params.component);

                const primarySelector =
                    matching[0]?.selector || fallbackSelectors[0];
                const matchesList =
                    matching.length > 0
                        ? matching.map((o) => o.selector)
                        : fallbackSelectors;

                if (
                    primarySelector &&
                    merged.props['data-theme-target'] === undefined
                ) {
                    Object.defineProperty(merged.props, 'data-theme-target', {
                        get() {
                            return primarySelector;
                        },
                        enumerable: true,
                        configurable: true,
                    });
                }

                if (merged.props['data-theme-matches'] === undefined) {
                    Object.defineProperty(merged.props, 'data-theme-matches', {
                        get() {
                            return matchesList.join(',');
                        },
                        enumerable: true,
                        configurable: true,
                    });
                }
            }

            // Convert semantic props to classes if component is not Nuxt UI
            let result: ResolvedOverride;
            if (!params.isNuxtUI) {
                result = this.mapPropsToClasses(merged);
            } else {
                result = merged;
            }

            // Cache the result
            if (canCache && cacheKey) {
                this.cache.set(cacheKey, result);
            }

            return result;
        } catch (error) {
            // Graceful degradation - log in dev, return empty in production
            if (import.meta.dev) {
                console.error(
                    '[theme-resolver] Override resolution failed:',
                    error,
                    {
                        theme: this.themeName,
                        params,
                    }
                );
            }

            // Return empty props - component uses defaults
            return { props: {} };
        }
    }

    /**
     * Generate a cache key for resolution parameters
     */
    private getCacheKey(params: ResolveParams): string {
        // Format: component|context|identifier|state|isNuxtUI
        // Use empty string for undefined values to keep key consistent
        return `${params.component}|${params.context || ''}|${
            params.identifier || ''
        }|${params.state || ''}|${params.isNuxtUI ? '1' : '0'}`;
    }

    /**
     * Check if an override matches the given component parameters
     *
     * Implements CSS-like specificity matching:
     * 1. Component type must match
     * 2. Context must match (if specified in override)
     * 3. Identifier must match (if specified in override)
     * 4. State must match (if specified in override)
     * 5. HTML attributes must match (if specified in override)
     *
     * @param override - Compiled override to check
     * @param params - Component parameters to match against
     * @returns true if override matches
     */
    private matches(
        override: CompiledOverride,
        params: ResolveParams
    ): boolean {
        // Component type is guaranteed to match by the index lookup

        // Context must match (if specified in override)
        // If override has a context, params MUST have the same context
        // If override has no context, it's a global override and matches any context
        if (override.context) {
            if (!params.context || override.context !== params.context) {
                return false;
            }
        }

        // Identifier must match (if specified in override)
        if (override.identifier && override.identifier !== params.identifier) {
            return false;
        }

        // State must match (if specified in override)
        if (override.state && override.state !== params.state) {
            return false;
        }

        // HTML attribute matching (if specified in override)
        if (override.attributes) {
            // If override requires attributes but no element provided, no match
            if (!params.element) {
                return false;
            }

            // Check all required attributes
            for (const matcher of override.attributes) {
                if (!this.matchesAttribute(params.element, matcher)) {
                    return false;
                }
            }
        }

        // All criteria matched
        return true;
    }

    /**
     * Check if an element matches an attribute selector
     *
     * Supports all CSS attribute selector operators:
     * - [attr] - attribute exists
     * - [attr="value"] - exact match
     * - [attr~="value"] - contains word
     * - [attr|="value"] - starts with word
     * - [attr^="value"] - starts with string
     * - [attr$="value"] - ends with string
     * - [attr*="value"] - contains substring
     *
     * @param element - HTML element to check
     * @param matcher - Attribute matcher to apply
     * @returns true if element matches
     */
    private matchesAttribute(
        element: HTMLElement | undefined,
        matcher: AttributeMatcher
    ): boolean {
        if (!element) return false;

        const attrValue = element.getAttribute(matcher.attribute);

        // [attr] - attribute exists
        if (matcher.operator === 'exists') {
            return attrValue !== null;
        }

        if (attrValue === null) return false;
        if (!matcher.value) return false;

        switch (matcher.operator) {
            case '=': // [attr="value"] - exact match
                return attrValue === matcher.value;

            case '~=': // [attr~="value"] - contains word
                return attrValue.split(/\s+/).includes(matcher.value);

            case '|=': // [attr|="value"] - starts with word
                return (
                    attrValue === matcher.value ||
                    attrValue.startsWith(matcher.value + '-')
                );

            case '^=': // [attr^="value"] - starts with string
                return attrValue.startsWith(matcher.value);

            case '$=': // [attr$="value"] - ends with string
                return attrValue.endsWith(matcher.value);

            case '*=': // [attr*="value"] - contains substring
                return attrValue.includes(matcher.value);

            default:
                return false;
        }
    }

    /**
     * Merge matching overrides by specificity
     *
     * Merging rules:
     * - Classes are concatenated (highest specificity first)
     * - UI objects are deep merged
     * - Other props: highest specificity wins
     *
     * @param overrides - Matching overrides (pre-sorted by specificity)
     * @returns Merged override props
     */
    private merge(overrides: CompiledOverride[]): ResolvedOverride {
        const merged: Record<string, unknown> = {};

        // Iterate in reverse (lowest specificity first, highest last)
        // This ensures highest specificity wins
        for (let i = overrides.length - 1; i >= 0; i--) {
            const override = overrides[i];
            if (!override) continue;

            for (const [key, value] of Object.entries(override.props)) {
                if (key === 'class') {
                    // Concatenate classes (highest specificity first)
                    const existingClass = merged[key];
                    const existingClassStr = typeof existingClass === 'string' ? existingClass : '';
                    merged[key] =
                        String(value) + (existingClassStr ? ` ${existingClassStr}` : '');
                } else if (key === 'ui') {
                    // Deep merge ui objects
                    const existingUi = merged[key];
                    merged[key] = this.deepMerge(
                        (existingUi && typeof existingUi === 'object' ? existingUi : {}) as Record<string, unknown>,
                        value as Record<string, unknown>
                    );
                } else {
                    // Higher specificity wins
                    merged[key] = value;
                }
            }
        }

        return { props: merged };
    }

    /**
     * Deep merge two objects
     *
     * @param target - Target object
     * @param source - Source object
     * @returns Merged object
     */
    private deepMerge(
        target: Record<string, unknown>,
        source: Record<string, unknown>
    ): Record<string, unknown> {
        const result = { ...target };

        for (const [key, value] of Object.entries(source)) {
            if (
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value)
            ) {
                // Recursively merge nested objects
                const existingValue = result[key];
                result[key] = this.deepMerge(
                    (existingValue && typeof existingValue === 'object' ? existingValue : {}) as Record<string, unknown>,
                    value as Record<string, unknown>
                );
            } else {
                // Override with source value
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Convert semantic props (variant, size, color) to CSS classes
     *
     * For custom components that don't understand Nuxt UI props,
     * we map variant/size/color to CSS classes using the theme's prop maps.
     *
     * @param override - Resolved override with semantic props
     * @returns Override with props mapped to classes
     */
    private mapPropsToClasses(override: ResolvedOverride): ResolvedOverride {
        const classes: string[] = [];
        const cleanProps: Record<string, unknown> = {};

        const entries = Object.entries(override.props);

        for (const [key, value] of entries) {
            if (key === 'ui') {
                // ui props only apply to Nuxt UI components; skip for native elements
                continue;
            }

            // Try to map semantic prop to class
            const mappedClass = this.tryMapPropToClass(key, value);
            if (mappedClass) {
                classes.push(mappedClass);
                continue; // Don't include in props
            }

            // Keep all other props (class, style, ui, data attributes, etc.)
            cleanProps[key] = value;
        }

        // Merge mapped classes with existing class prop
        if (classes.length > 0) {
            const existingClass = (cleanProps.class as string) || '';
            cleanProps.class = [...classes, existingClass]
                .filter(Boolean)
                .join(' ');
        }

        return { props: cleanProps };
    }

    /**
     * Try to map a semantic prop to a CSS class
     *
     * @param propName - Property name (variant, size, color)
     * @param propValue - Property value
     * @returns Mapped class name or null if not mapped
     */
    private tryMapPropToClass(
        propName: string,
        propValue: unknown
    ): string | null {
        if (typeof propValue !== 'string') return null;

        switch (propName) {
            case 'variant':
                return this.propMaps.variant?.[propValue] || null;
            case 'size':
                return this.propMaps.size?.[propValue] || null;
            case 'color':
                return this.propMaps.color?.[propValue] || null;
            default:
                return null;
        }
    }
}

/**
 * Default prop-to-class mappings
 *
 * These are used when a theme doesn't provide custom mappings.
 * They follow standard Tailwind/Nuxt UI conventions.
 */
export const defaultPropMaps: PropClassMaps = {
    variant: {
        solid: 'variant-solid',
        outline: 'variant-outline',
        ghost: 'variant-ghost',
        soft: 'variant-soft',
        link: 'variant-link',
    },
    size: {
        xs: 'text-xs px-2 py-1',
        sm: 'text-sm px-3 py-1.5',
        md: 'text-base px-4 py-2',
        lg: 'text-lg px-5 py-2.5',
        xl: 'text-xl px-6 py-3',
    },
    color: {
        primary: 'text-primary-600 bg-primary-50 border-primary-300',
        secondary: 'text-secondary-600 bg-secondary-50 border-secondary-300',
        success: 'text-green-600 bg-green-50 border-green-300',
        error: 'text-red-600 bg-red-50 border-red-300',
        warning: 'text-yellow-600 bg-yellow-50 border-yellow-300',
        info: 'text-blue-600 bg-blue-50 border-blue-300',
    },
};
