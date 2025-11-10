/**
 * Refined Theme System - Core Type Definitions
 *
 * This file contains all the core TypeScript interfaces for the refined theme system.
 * It defines the structure of theme definitions, overrides, and compiled theme configs.
 */

/**
 * Material Design 3 Color Palette
 * Defines all the color tokens used in a theme.
 */
export interface ColorPalette {
    // Primary colors
    primary: string;
    onPrimary?: string; // Auto-calculated if omitted
    primaryContainer?: string;
    onPrimaryContainer?: string;

    // Secondary colors
    secondary: string;
    onSecondary?: string;
    secondaryContainer?: string;
    onSecondaryContainer?: string;

    // Tertiary colors
    tertiary?: string;
    onTertiary?: string;
    tertiaryContainer?: string;
    onTertiaryContainer?: string;

    // Error colors
    error?: string;
    onError?: string;
    errorContainer?: string;
    onErrorContainer?: string;

    // Surface colors
    surface: string;
    onSurface?: string;
    surfaceVariant?: string;
    onSurfaceVariant?: string;
    inverseSurface?: string;
    inverseOnSurface?: string;

    // Outline
    outline?: string;
    outlineVariant?: string;

    // Border color (light/dark palettes can override)
    borderColor?: string;

    // App-specific tokens
    success?: string;
    warning?: string;
    info?: string;

    // Dark mode overrides (optional)
    dark?: Partial<Omit<ColorPalette, 'dark'>>;
}

/**
 * Valid repeat options for background layers
 */
export type BackgroundRepeat = 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';

/**
 * Background layer configuration
 */
export interface ThemeBackgroundLayer {
    image?: string | null;
    color?: string;
    opacity?: number;
    repeat?: BackgroundRepeat;
    size?: string;
    fit?: 'cover' | 'contain';
}

/**
 * Named background slots exposed through the theme DSL
 */
export interface ThemeBackgrounds {
    content?: {
        base?: ThemeBackgroundLayer;
        overlay?: ThemeBackgroundLayer;
    };
    sidebar?: ThemeBackgroundLayer;
    headerGradient?: ThemeBackgroundLayer;
    bottomNavGradient?: ThemeBackgroundLayer;
}

/**
 * CSS attribute selector operators
 */
export type AttributeOperator =
    | 'exists' // [attr]
    | '=' // [attr="value"]
    | '~=' // [attr~="value"] - contains word
    | '|=' // [attr|="value"] - starts with word
    | '^=' // [attr^="value"] - starts with
    | '$=' // [attr$="value"] - ends with
    | '*='; // [attr*="value"] - contains

/**
 * Attribute matcher for HTML attribute selectors
 */
export interface AttributeMatcher {
    attribute: string;
    operator: AttributeOperator;
    value?: string;
}

/**
 * Override props that can be applied to components
 *
 * For Nuxt UI components: Props like variant, color, size are passed directly
 * For custom components: These props are mapped to CSS classes via prop-class-maps
 */
export interface OverrideProps {
    /** Component variant (e.g., 'solid', 'outline', 'ghost', 'soft', 'link') */
    variant?: string;

    /** Component size (e.g., 'xs', 'sm', 'md', 'lg', 'xl', '2xs', '2xl') */
    size?: string;

    /** Component color (e.g., 'primary', 'secondary', 'success', 'error', 'warning', 'info') */
    color?: string;

    /** Additional CSS classes - always applied directly to element */
    class?: string;

    /** Inline styles object - applied directly to element */
    style?: Record<string, string>;

    /** Nuxt UI component-specific config object (passed to :ui prop) */
    ui?: Record<string, unknown>;

    /** Allow any additional component-specific props */
    [key: string]: unknown;
}

/**
 * Prop-to-class mapping configuration
 * Maps semantic props (variant, size, color) to CSS classes
 */
export interface PropClassMaps {
    variant?: Record<string, string>;
    size?: Record<string, string>;
    color?: Record<string, string>;
}

/**
 * CSS Selector Configuration
 * Allows targeting elements by CSS selector with either style properties or Tailwind classes
 */
export interface CSSelectorConfig {
    /** Direct CSS properties to apply (compiled to CSS file at build time) */
    style?: Record<string, string>;

    /** Tailwind utility classes to apply (applied at runtime via classList) */
    class?: string;
}

/**
 * Theme Definition (Author-facing DSL)
 *
 * This is the interface that theme authors use to define new themes.
 * It uses a simplified, convention-based structure.
 */
export interface ThemeDefinition {
    /** Unique theme identifier (kebab-case) */
    name: string;

    /** Human-readable display name */
    displayName?: string;

    /** Theme description */
    description?: string;

    /** Marks this theme as the default selection */
    isDefault?: boolean;

    /** Color palette (Material Design 3 tokens) */
    colors: ColorPalette;

    /** Default border width (e.g., '2px', '1px') - generates --md-border-width */
    borderWidth?: string;

    /** Default border radius (e.g., '3px', '8px') - generates --md-border-radius */
    borderRadius?: string;

    /**
     * Component overrides using CSS selector syntax
     *
     * Examples:
     * - 'button': Global button overrides
     * - 'button.chat': Context-specific (auto-expanded to [data-context="chat"])
     * - 'button#chat.send': Identifier-specific (auto-expanded to [data-id="chat.send"])
     * - 'button:hover': State-based
     * - 'button[id="submit"]': HTML attribute targeting
     */
    overrides?: Record<string, OverrideProps>;

    /**
     * CSS Selectors for direct DOM targeting
     *
     * Use this for third-party libraries, legacy code, or rapid prototyping.
     * Supports both direct CSS properties (build-time) and Tailwind classes (runtime).
     *
     * Examples:
     * - '.monaco-editor': { style: { border: '2px solid var(--md-primary)' } }
     * - '.custom-modal': { class: 'fixed inset-0 bg-black/50' }
     * - '.tooltip': { style: { ... }, class: 'rounded-md shadow-lg' }
     */
    cssSelectors?: Record<string, CSSelectorConfig>;

    /** CSS stylesheets to load automatically when the theme is available */
    stylesheets?: string[];

    /** Nuxt UI config extensions */
    ui?: Record<string, unknown>;

    /** Custom prop-to-class mappings for this theme */
    propMaps?: PropClassMaps;

    /** Background descriptions that map to CSS variables */
    backgrounds?: ThemeBackgrounds;
}

/**
 * Parsed selector components
 */
export interface ParsedSelector {
    /** Component type (e.g., 'button', 'input') */
    component: string;

    /** Context name (from data-context attribute) */
    context?: string;

    /** Identifier (from data-id attribute) */
    identifier?: string;

    /** Pseudo-class state (e.g., 'hover', 'active', 'focus') */
    state?: string;

    /** HTML attribute matchers */
    attributes?: AttributeMatcher[];
}

/**
 * Compiled override (Runtime format)
 *
 * This is the optimized format used at runtime for override resolution.
 * The compiler transforms CSS selectors into this format.
 */
export interface CompiledOverride {
    /** Component type */
    component: string;

    /** Context name (optional) */
    context?: string;

    /** Identifier (optional) */
    identifier?: string;

    /** State (optional) */
    state?: string;

    /** HTML attribute matchers (optional) */
    attributes?: AttributeMatcher[];

    /** Override props to apply */
    props: OverrideProps;

    /** Original CSS selector (for debugging) */
    selector: string;

    /** Pre-calculated specificity score */
    specificity: number;
}

/**
 * Compiled theme configuration (Runtime format)
 */
export interface CompiledTheme {
    /** Theme name */
    name: string;

    /** Indicates if this theme is the default choice */
    isDefault?: boolean;

    /** Stylesheets that were requested by the theme definition */
    stylesheets?: string[];

    /** Display name */
    displayName?: string;

    /** Description */
    description?: string;

    /** Generated CSS variables */
    cssVariables: string;

    /** Compiled overrides (sorted by specificity) */
    overrides: CompiledOverride[];

    /** CSS selectors for direct DOM targeting */
    cssSelectors?: Record<string, CSSelectorConfig>;

    /** Indicates if cssSelectors include style blocks that require static CSS */
    hasStyleSelectors?: boolean;

    /** Nuxt UI config */
    ui?: Record<string, unknown>;

    /** Prop-to-class mappings */
    propMaps?: PropClassMaps;

    /** Theme background metadata (optional) */
    backgrounds?: ThemeBackgrounds;
}

/**
 * Validation error
 */
export interface ValidationError {
    severity: 'error' | 'warning';
    code: string;
    message: string;
    file: string;
    line?: number;
    column?: number;
    suggestion?: string;
    docsUrl?: string;
}

/**
 * Theme compilation result
 */
export interface ThemeCompilationResult {
    /** Theme name */
    name: string;

    /** Compiled theme config */
    theme: CompiledTheme;

    /** Validation errors */
    errors: ValidationError[];

    /** Validation warnings */
    warnings: ValidationError[];

    /** Success flag */
    success: boolean;
}

/**
 * Overall compilation result
 */
export interface CompilationResult {
    /** Individual theme results */
    themes: ThemeCompilationResult[];

    /** Overall success flag */
    success: boolean;

    /** Total errors across all themes */
    totalErrors: number;

    /** Total warnings across all themes */
    totalWarnings: number;
}

/**
 * Runtime override resolution parameters
 */
export interface ResolveParams {
    /** Component type */
    component: string;

    /** Context (optional) */
    context?: string;

    /** Identifier (optional) */
    identifier?: string;

    /** State (optional) */
    state?: string;

    /** HTML element for attribute matching (optional) */
    element?: HTMLElement;

    /** Whether component is a Nuxt UI component */
    isNuxtUI?: boolean;
}

/**
 * Resolved override result
 */
export interface ResolvedOverride {
    /** Merged props */
    props: Record<string, unknown> & {
        /** Development debugging attributes */
        'data-theme-target'?: string;
        'data-theme-matches'?: string;
        /** Standard component props */
        class?: string;
        style?: Record<string, string>;
        ui?: Record<string, unknown>;
        /** Allow any additional component-specific props */
        [key: string]: unknown;
    };
}
