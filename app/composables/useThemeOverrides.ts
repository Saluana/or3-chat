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
  state: Ref<ComponentState> = ref<ComponentState>('default')
) {
  const { $theme } = useNuxtApp() as unknown as { $theme: ThemePlugin };
  const element = ref<HTMLElement | null>(null);
  
  // Get component element on mount (runs once during setup)
  onMounted(() => {
    element.value = getCurrentInstance()?.proxy?.$el as HTMLElement;
  });
  
  // Resolve context value (handles both static and reactive context)
  const contextValue = computed(() => {
    return typeof context === 'object' && 'value' in context 
      ? context.value 
      : context;
  });
  
  // Resolve component props reactively
  const resolvedProps = computed(() => toValue(componentProps));
  
  // Build override context with actual component props and reactive state
  const overrideContext = computed<OverrideContext>(() => ({
    mode: $theme.current.value as any,
    theme: $theme.activeTheme.value,
    element: element.value || undefined,
    componentProps: resolvedProps.value as Record<string, unknown>,
    state: state.value,
  }));
  
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
      overrides: readonly(overrides) as unknown as Readonly<Partial<TProps>>,
      debug: readonly(debugInfo),
    };
  }
  
  return {
    overrides: readonly(overrides) as unknown as Readonly<Partial<TProps>>,
  };
}

/**
 * Auto-detect context from DOM hierarchy
 */
export function useAutoContext(): Ref<ContextSelector> {
  const element = ref<HTMLElement | null>(null);
  
  onMounted(() => {
    element.value = getCurrentInstance()?.proxy?.$el as HTMLElement;
  });
  
  const context = computed<ContextSelector>(() => {
    if (!element.value) return 'global';
    
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
  state: Ref<ComponentState> = ref<ComponentState>('default')
) {
  const context = useAutoContext();
  
  // Delegate to useThemeOverrides with reactive context and props - no dual paths!
  return useThemeOverrides<TProps>(componentType, context, componentProps, state);
}
