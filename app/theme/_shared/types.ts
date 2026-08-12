import type { Component, Ref, ShallowRef } from 'vue';
import type { RuntimeResolver } from './runtime-resolver';
import type { WorkspaceProfileV1 } from '../../core/workspace-profiles/schema';

/**
 * @module app/theme/_shared/types
 *
 * Purpose:
 * Core TypeScript interfaces for the refined theme system.
 *
 * Behavior:
 * - Defines author facing and runtime theme structures
 *
 * Constraints:
 * - These are structural types only
 */

/**
 * Material Design 3 Color Palette
 * Defines all the color tokens used in a theme.
 */
export const APP_THEME_COMPONENT_KEYS = [
    'sidebar',
    'sidebar-collapsed',
    'chat-page',
    'chat-message',
    'chat-input',
    'document-editor',
    'dashboard-modal',
    'model-selector',
    'system-prompts-modal',
    'model-catalog-modal',
    'sidebar-auth-button',
    'documentation-shell',
    'workflow-status',
] as const;

export type AppThemeComponent = (typeof APP_THEME_COMPONENT_KEYS)[number];
export const THEME_COMPONENT_CONTRACT_VERSION = 1 as const;
export type ThemeComponentContractVersion =
    typeof THEME_COMPONENT_CONTRACT_VERSION;

type CustomColorTokens = Record<string, string | undefined>;

interface BaseColorPalette {
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
}

/**
 * `ColorPalette`
 *
 * Purpose:
 * Defines the theme color palette with optional dark overrides.
 *
 * Constraints:
 * - Custom token keys map to CSS variables
 */
export interface ColorPalette extends BaseColorPalette {
    // Dark mode overrides (optional)
    dark?: Partial<BaseColorPalette> & CustomColorTokens;

    /**
     * Additional custom tokens.
     * Any camelCase key automatically maps to a CSS variable --md-${kebab-case(key)}.
     */
    [customToken: string]:
        | string
        | undefined
        | (Partial<BaseColorPalette> & CustomColorTokens);
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
 * Shared background slots for a single color mode.
 */
export interface ThemeBackgroundSlots {
    content?: {
        base?: ThemeBackgroundLayer;
        overlay?: ThemeBackgroundLayer;
    };
    sidebar?: ThemeBackgroundLayer;
    headerGradient?: ThemeBackgroundLayer;
    bottomNavGradient?: ThemeBackgroundLayer;
}

/**
 * Named background slots exposed through the theme DSL
 */
export interface ThemeBackgrounds extends ThemeBackgroundSlots {
    /**
     * Optional dark-mode overrides for background layers.
     * Only specify fields you want to differ from light/default.
     */
    dark?: ThemeBackgroundSlots;
}

/**
 * Optional shared density tokens authored by a theme. Components retain a
 * local literal fallback, so third-party themes may omit these safely.
 */
export interface ThemeDensityTokens {
    controlHeightSmall?: string;
    controlHeightMedium?: string;
    controlHeightLarge?: string;
    spaceControl?: string;
    spaceSection?: string;
}

/** Focus affordance tokens authored by a theme. */
export interface ThemeFocusTokens {
    ringColor?: string;
    ringOffset?: string;
}

/** Shared transition tokens authored by a theme. */
export interface ThemeMotionTokens {
    durationFast?: string;
    durationMedium?: string;
    durationSlow?: string;
    easingStandard?: string;
}

/** Shared elevation stacks authored by a theme. */
export interface ThemeElevationTokens {
    low?: string;
    medium?: string;
    high?: string;
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
 * `useThemeOverrides()` exposes these values for `v-bind` on Nuxt UI components.
 * Non-Nuxt UI resolution can map variant, color, and size through prop maps.
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
/**
 * `ThemeDefinition`
 *
 * Purpose:
 * Author facing theme definition contract.
 *
 * Constraints:
 * - `name` must be kebab case and unique across themes
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

    /** Divider/hairline width - generates --md-border-width-subtle */
    borderWidthSubtle?: string;

    /** Default component border width - generates --md-border-width */
    borderWidth?: string;

    /** Emphasized border width - generates --md-border-width-strong */
    borderWidthStrong?: string;

    /** Compact-control radius - generates --md-border-radius-small */
    borderRadiusSmall?: string;

    /** Default surface radius - generates --md-border-radius */
    borderRadius?: string;

    /** Large panel/dialog radius - generates --md-border-radius-large */
    borderRadiusLarge?: string;

    /** Shared control heights and layout gaps for density-aware components. */
    density?: ThemeDensityTokens;

    /** Theme-authored color and offset for keyboard focus indicators. */
    focus?: ThemeFocusTokens;

    /** Shared duration and easing tokens for appearance transitions. */
    motion?: ThemeMotionTokens;

    /** Shared low/medium/high elevation stacks for generic raised surfaces. */
    elevation?: ThemeElevationTokens;

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

    /**
     * Canonical Nuxt UI component recipes for this theme. These are merged
     * after the immutable application config and any legacy app.config patch.
     */
    ui?: Record<string, unknown>;

    /** Custom prop-to-class mappings for this theme */
    propMaps?: PropClassMaps;

    /** Background descriptions that map to CSS variables */
    backgrounds?: ThemeBackgrounds;

    /** Font family tokens for this theme */
    fonts?: ThemeFonts;

    /** Icon overrides for this theme */
    icons?: Record<string, string>;

    /** Theme-provided Vue component overrides keyed by supported app surface */
    customComponents?: Partial<Record<AppThemeComponent, string>>;

    /** Compatibility version for trusted custom component replacements */
    componentContractVersion?: ThemeComponentContractVersion;

    /**
     * Optional declarative workspace layouts packaged by the theme.
     * They are registered as choices only; activating a theme never applies one.
     */
    workspaceProfiles?: WorkspaceProfileV1[];

    /** Optional profile surfaced as an explicit recommendation action. */
    recommendedWorkspaceProfileId?: string;
}

export interface ThemeFontSet {
    sans?: string;
    heading?: string;
    mono?: string;
    /**
     * Base font size for the theme (e.g., '16px', '1rem')
     * Applied to --app-font-size-root.
     */
    baseSize?: string;
    /**
     * Base font weight for the theme body text (e.g., '400', '500').
     * Applied to --app-font-weight-root.
     */
    baseWeight?: string;
}

export interface ThemeFonts extends ThemeFontSet {
    dark?: ThemeFontSet;
}

/**
 * Parsed selector components
 */
/**
 * `ParsedSelector`
 *
 * Purpose:
 * Parsed selector components used by compiler and runtime.
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
/**
 * `CompiledOverride`
 *
 * Purpose:
 * Runtime friendly override structure with specificity.
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

    /** Declaration order within the theme; later equal-specificity rules win */
    sourceOrder?: number;
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

    /** Icon overrides for this theme */
    icons?: Record<string, string>;

    /** Theme-provided Vue component override paths */
    customComponents?: Partial<Record<AppThemeComponent, string>>;

    /** Compatibility version for trusted custom component replacements */
    componentContractVersion?: ThemeComponentContractVersion;

    /** Validated declarative profiles bundled with this theme. */
    workspaceProfiles?: WorkspaceProfileV1[];

    /** Recommendation metadata only; never an automatic selection. */
    recommendedWorkspaceProfileId?: string;
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

    /** Source directory name used by Vite module discovery. */
    dirName?: string;

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

    /** Element-like attribute source for selector matching (optional) */
    element?: { getAttribute(name: string): string | null };

    /** Whether component is a Nuxt UI component */
    isNuxtUI?: boolean;
}

/**
 * Resolved override result
 */
export interface ResolvedOverride {
    /** Merged props */
    props: ResolvedOverrideProps;
}

export interface ResolvedOverrideProps extends Record<string, unknown> {
    'data-theme-target'?: string;
    'data-theme-matches'?: string;
    class?: string;
    style?: Record<string, string>;
    ui?: Record<string, unknown>;
}

export interface ThemePlugin {
    set: (name: string) => void;
    toggle: () => void;
    get: () => string;
    system: () => string;
    current: Ref<string>;
    activeTheme: Ref<string>;
    resolversVersion: Ref<number>;
    setActiveTheme: (themeName: string) => Promise<void>;
    getResolver: (themeName: string) => RuntimeResolver | null;
    loadTheme: (themeName: string) => Promise<CompiledTheme | null>;
    getTheme: (themeName: string) => CompiledTheme | null;
    activeComponents: ShallowRef<Record<AppThemeComponent, Component>>;
    availableThemes?: ReadonlyArray<{
        name: string;
        displayName?: string;
        description?: string;
    }>;
}
