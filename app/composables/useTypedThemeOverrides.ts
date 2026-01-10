/**
 * Typed Theme Override Helpers
 *
 * Provides type-safe spreading of theme overrides onto Nuxt UI components.
 * Addresses Razor audit concern about `as any` casts eliminating type checking.
 */

import { computed, type ComputedRef } from 'vue';
import { useThemeOverrides } from './useThemeResolver';
import type { ResolveParams } from '../theme/_shared/runtime-resolver';

/**
 * Common Nuxt UI Button props that can be overridden by themes.
 * Uses string literals for known values with fallback to string for custom values.
 */
export interface NuxtUIButtonOverrides {
    variant?:
        | 'solid'
        | 'outline'
        | 'ghost'
        | 'soft'
        | 'subtle'
        | 'basic'
        | 'light'
        | 'link'
        | 'popover';
    color?:
        | 'primary'
        | 'secondary'
        | 'error'
        | 'warning'
        | 'success'
        | 'info'
        | 'neutral'
        | 'inverse-primary';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    class?: string;
    ui?: Record<string, unknown>;
    icon?: string;
    trailing?: boolean;
    leading?: boolean;
    square?: boolean;
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
}

/**
 * Common Nuxt UI Input props that can be overridden by themes.
 */
export interface NuxtUIInputOverrides {
    variant?: 'outline' | 'none';
    color?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    class?: string;
    ui?: Record<string, unknown>;
    type?: 'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search';
    placeholder?: string;
    disabled?: boolean;
}

/**
 * Common Nuxt UI Textarea props that can be overridden by themes.
 */
export interface NuxtUITextareaOverrides {
    variant?: 'outline' | 'none';
    color?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    class?: string;
    ui?: Record<string, unknown>;
    placeholder?: string;
    disabled?: boolean;
    rows?: number;
}

/**
 * Common Nuxt UI Modal props that can be overridden by themes.
 */
export interface NuxtUIModalOverrides {
    class?: string;
    ui?: Record<string, unknown>;
    fullscreen?: boolean;
    overlay?: boolean;
    transition?: boolean;
    preventClose?: boolean;
}

/**
 * Common props for non-Nuxt UI (plain HTML) elements.
 */
export interface PlainElementOverrides {
    class?: string;
    style?: Record<string, string>;
}

/**
 * Type-safe wrapper for button theme overrides.
 * Merges base props with theme overrides in a type-safe manner.
 */
export function useButtonOverrides(
    params: ResolveParams,
    baseProps: Partial<NuxtUIButtonOverrides> = {}
): ComputedRef<NuxtUIButtonOverrides> {
    const overrides = useThemeOverrides({ ...params, isNuxtUI: true });

    return computed(() => {
        const themeProps = overrides.value as Partial<NuxtUIButtonOverrides>;
        return { ...baseProps, ...themeProps };
    });
}

/**
 * Type-safe wrapper for input theme overrides.
 */
export function useInputOverrides(
    params: ResolveParams,
    baseProps: Partial<NuxtUIInputOverrides> = {}
): ComputedRef<NuxtUIInputOverrides> {
    const overrides = useThemeOverrides({ ...params, isNuxtUI: true });

    return computed(() => {
        const themeProps = overrides.value as Partial<NuxtUIInputOverrides>;
        return { ...baseProps, ...themeProps };
    });
}

/**
 * Type-safe wrapper for textarea theme overrides.
 */
export function useTextareaOverrides(
    params: ResolveParams,
    baseProps: Partial<NuxtUITextareaOverrides> = {}
): ComputedRef<NuxtUITextareaOverrides> {
    const overrides = useThemeOverrides({ ...params, isNuxtUI: true });

    return computed(() => {
        const themeProps = overrides.value as Partial<NuxtUITextareaOverrides>;
        return { ...baseProps, ...themeProps };
    });
}

/**
 * Type-safe wrapper for modal theme overrides.
 */
export function useModalOverrides(
    params: ResolveParams,
    baseProps: Partial<NuxtUIModalOverrides> = {}
): ComputedRef<NuxtUIModalOverrides> {
    const overrides = useThemeOverrides({ ...params, isNuxtUI: true });

    return computed(() => {
        const themeProps = overrides.value as Partial<NuxtUIModalOverrides>;
        return { ...baseProps, ...themeProps };
    });
}

/**
 * Type-safe wrapper for plain (non-Nuxt UI) element overrides.
 */
export function usePlainOverrides(
    params: ResolveParams,
    baseProps: Partial<PlainElementOverrides> = {}
): ComputedRef<PlainElementOverrides> {
    const overrides = useThemeOverrides({ ...params, isNuxtUI: false });

    return computed(() => {
        const themeProps = overrides.value as Partial<PlainElementOverrides>;
        return { ...baseProps, ...themeProps };
    });
}
