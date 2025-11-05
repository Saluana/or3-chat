import { ref, computed, readonly, onMounted, getCurrentInstance, watch, type Ref, type MaybeRef } from 'vue';
import { useNuxtApp } from '#app';
import type { ComponentType, ContextSelector, OverrideContext, ComponentState } from '~/theme/_shared/override-types';
import { getOverrideResolver } from '~/theme/_shared/override-resolver';
import { toValue } from '@vueuse/core';

// Interface for the theme plugin provided by Nuxt
interface ThemePlugin {
  current: Ref<string>;
  activeTheme: Ref<string>;
}

/**
 * Composable for accessing theme overrides with TypeScript generics
 */
export function useThemeOverrides<TProps = Record<string, unknown>>(
  componentType: ComponentType,
  context: ContextSelector | Ref<ContextSelector> = 'global',
  componentProps: MaybeRef<Partial<TProps>> = {},
  state: Ref<ComponentState> = ref<ComponentState>('default'),
  identifier?: MaybeRef<string | undefined>
) {
  const { $theme } = useNuxtApp() as unknown as { $theme: ThemePlugin };
  const element = ref<HTMLElement | null>(null);
  
  // Get component element on mount (runs once during setup)
  onMounted(() => {
    const el = getCurrentInstance()?.proxy?.$el;
    // Ensure we have a proper HTMLElement
    if (el && typeof el === 'object' && 'closest' in el) {
      element.value = el as HTMLElement;
    }
  });
  
  // Resolve context value (handles both static and reactive context)
  const contextValue = computed(() => {
    return typeof context === 'object' && 'value' in context 
      ? context.value 
      : context;
  });
  
  // Resolve component props reactively
  const resolvedProps = computed(() => toValue(componentProps));
  const resolvedIdentifier = computed(() =>
    identifier ? toValue(identifier) ?? undefined : undefined
  );
  
  // Build override context with actual component props and reactive state
  const overrideContext = computed<OverrideContext>(() => {
    // During SSR, use a simplified context without element detection
    const isSSR = typeof window === 'undefined';
    
    return {
      mode: $theme.current.value as any,
      theme: $theme.activeTheme.value,
      element: isSSR ? undefined : (element.value || undefined),
      componentProps: resolvedProps.value as Record<string, unknown>,
      state: state.value,
      identifier: resolvedIdentifier.value,
    };
  });
  
  // Resolve overrides
  const overrides = computed(() => {
    const resolver = getOverrideResolver();
    if (!resolver) {
      return {};
    }
    
    try {
      const result = resolver.resolve(
        componentType,
        contextValue.value,
        overrideContext.value
      );
      
      return result.props as Partial<TProps>;
    } catch (error) {
      console.error('[useThemeOverrides] Resolution failed:', error);
      return {};
    }
  });
  
  // Debug info (only in dev)
  if (import.meta.dev) {
    const debugInfo = computed(() => {
      const resolver = getOverrideResolver();
      if (!resolver) return null;
      
      try {
        const result = resolver.resolve(
          componentType,
          contextValue.value,
          overrideContext.value
        );
        
        return {
          component: componentType,
          context: contextValue.value,
          appliedRules: result.rules.length,
          cacheKey: result.cacheKey,
          theme: overrideContext.value.theme,
          mode: overrideContext.value.mode,
          componentProps: overrideContext.value.componentProps,
          state: overrideContext.value.state,
          identifier: overrideContext.value.identifier,
        };
      } catch (error) {
        return {
          component: componentType,
          context: contextValue.value,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
    
    // Log when overrides change
    watch(overrides, (newVal, oldVal) => {
      if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        console.log('[useThemeOverrides]', debugInfo.value);
      }
    }, { deep: true });
    
    // Expose debug info in development
    return {
      overrides: readonly(overrides) as Readonly<Ref<Partial<TProps>>>,
      debug: readonly(debugInfo),
    };
  }
  
  return {
    overrides: readonly(overrides) as Readonly<Ref<Partial<TProps>>>,
  };
}

/**
 * Auto-detect context from DOM hierarchy
 */
export function useAutoContext(): Ref<ContextSelector> {
  const element = ref<HTMLElement | null>(null);
  
  onMounted(() => {
    const el = getCurrentInstance()?.proxy?.$el;
    // Ensure we have a proper HTMLElement with closest method
    if (el && typeof el === 'object' && 'closest' in el) {
      element.value = el as HTMLElement;
    }
  });
  
  const context = computed<ContextSelector>(() => {
    // During SSR, always return 'global' to avoid hydration mismatches
    if (typeof window === 'undefined') {
      return 'global';
    }
    
    if (!element.value) return 'global';
    
    // Double-check that element has closest method
    if (!('closest' in element.value)) return 'global';
    
    // Check for known context IDs
    if (element.value.closest('#app-chat-container')) return 'chat';
    if (element.value.closest('#app-sidebar')) return 'sidebar';
    if (element.value.closest('#app-dashboard-modal')) return 'dashboard';
    if (element.value.closest('#app-header')) return 'header';
    
    return 'global';
  });
  
  return context;
}

/**
 * Merge theme overrides with component props
 */
export function mergeOverrides<TProps extends Record<string, unknown>>(
  themeProps: Partial<TProps>,
  componentProps: Partial<TProps>
): Partial<TProps> {
  const merged = { ...themeProps };
  
  // Component props win
  for (const [key, value] of Object.entries(componentProps)) {
    if (value === undefined) continue;
    
    if (key === 'class') {
      // Concatenate classes
      merged[key as keyof TProps] = (merged[key as keyof TProps] as any)
        ? `${merged[key as keyof TProps]} ${value}`
        : value;
    } else if (key === 'ui' && typeof value === 'object') {
      // Deep merge ui objects
      merged[key as keyof TProps] = deepMerge(
        merged[key as keyof TProps] as Record<string, unknown> ?? {},
        value as Record<string, unknown>
      ) as any;
    } else {
      // Component prop wins
      merged[key as keyof TProps] = value;
    }
  }
  
  return merged;
}

/**
 * Deep merge objects with proper typing
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown> ?? {},
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Enhanced useThemeOverrides with auto-context detection
 */
export function useThemeOverridesAuto<TProps = Record<string, unknown>>(
  componentType: ComponentType,
  componentProps: MaybeRef<Partial<TProps>> = {},
  state: Ref<ComponentState> = ref<ComponentState>('default'),
  identifier?: MaybeRef<string | undefined>
) {
  const context = useAutoContext();
  
  // Delegate to useThemeOverrides with reactive context and props - no dual paths!
  return useThemeOverrides<TProps>(componentType, context, componentProps, state, identifier);
}
