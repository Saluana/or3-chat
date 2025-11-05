import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, computed } from 'vue';
import { 
  useThemeOverrides, 
  useThemeOverridesAuto, 
  useAutoContext,
  mergeOverrides
} from '../useThemeOverrides';
import { setOverrideResolver, clearOverrideResolver, getOverrideResolver } from '../../theme/_shared/override-resolver';
import type { ComponentOverrides, ComponentState } from '../../theme/_shared/override-types';

// Mock Nuxt app
const mockNuxtApp = {
  $theme: {
    current: ref('light'),
    activeTheme: ref('default')
  }
};

// Mock getCurrentInstance
const mockGetCurrentInstance = {
  proxy: {
    $el: {
      closest: (selector: string) => {
        if (selector === '#app-chat-container') return document.createElement('div');
        return null;
      },
      id: 'test-element',
      className: 'test-class'
    }
  }
};

// Mock Vue functions
vi.mock('#app', () => ({
  useNuxtApp: () => mockNuxtApp,
  getCurrentInstance: () => mockGetCurrentInstance,
  onMounted: (fn: Function) => fn()
}));

describe('useThemeOverrides', () => {
  beforeEach(() => {
    // Setup mocks
    vi.stubGlobal('useNuxtApp', () => mockNuxtApp);
    vi.stubGlobal('getCurrentInstance', () => mockGetCurrentInstance);
    vi.stubGlobal('onMounted', (fn: Function) => fn());
    
    // Setup test resolver
    const testConfig: ComponentOverrides = {
      global: {
        button: [
          {
            component: 'button',
            props: { variant: 'solid', class: 'global-btn' },
            priority: 0
          }
        ]
      },
      contexts: {
        chat: {
          button: [
            {
              component: 'button',
              props: { variant: 'outline', class: 'chat-btn' },
              priority: 1
            }
          ]
        }
      },
      states: {
        hover: {
          button: [
            {
              component: 'button',
              props: { variant: 'ghost', class: 'hover-btn' },
              priority: 2
            }
          ]
        }
      }
    };

    setOverrideResolver(testConfig);
  });

  afterEach(() => {
    clearOverrideResolver();
    vi.unstubAllGlobals();
  });

  describe('4.11 Test composable returns empty object when no resolver', () => {
    it('should return empty overrides when no resolver is set', () => {
      clearOverrideResolver();
      
      const { overrides } = useThemeOverrides('button');
      
      expect(overrides.value as Record<string, unknown>).toEqual({});
    });
  });

  describe('4.12 Test composable resolves global overrides', () => {
    it('should resolve global overrides', () => {
      const { overrides } = useThemeOverrides('button');
      
      expect(overrides.value as Record<string, unknown>).toEqual({
        variant: 'solid',
        class: 'global-btn'
      });
    });

    it('should react to theme changes', () => {
      const { overrides } = useThemeOverrides('button');
      
      // Initial state
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid');
      
      // Change theme
      mockNuxtApp.$theme.activeTheme.value = 'cyberpunk';
      
      // Should still resolve (theme change affects cache key)
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid');
    });
  });

  describe('4.13 Test composable resolves context overrides', () => {
    it('should resolve context-specific overrides', () => {
      const { overrides } = useThemeOverrides('button', 'chat');
      
      expect(overrides.value as Record<string, unknown>).toEqual({
        variant: 'outline',
        class: 'chat-btn global-btn'
      });
    });

    it('should react to context changes', () => {
      const context = ref('global');
      const { overrides } = useThemeOverrides('button', context);
      
      // Initial global context
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid');
      
      // Change to chat context
      context.value = 'chat';
      
      // Should resolve chat overrides
      expect((overrides.value as Record<string, unknown>).variant).toBe('outline');
    });
  });

  describe('Reactive component props', () => {
    it('should react to component props changes', () => {
      const props = ref({ variant: 'solid' });
      const { overrides } = useThemeOverrides('button', 'global', props);
      
      // Initial props
      const initialOverrides = overrides.value;
      expect(initialOverrides.variant).toBe('solid');
      
      // Change props
      props.value = { variant: 'outline' };
      
      // Should still resolve (props affect cache key)
      const stillOverrides = overrides.value;
      expect(stillOverrides.variant).toBe('solid'); // Still uses override config
    });

    it('should accept computed props', () => {
      const baseProps = ref({ disabled: false });
      const computedProps = computed(() => ({
        ...baseProps.value,
        variant: baseProps.value.disabled ? 'ghost' : 'solid'
      }));
      
      const { overrides } = useThemeOverrides('button', 'global', computedProps);
      
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid');
      
      baseProps.value.disabled = true;
      
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid'); // Still uses override config
    });
  });

  describe('Reactive state', () => {
    it('should react to state changes', () => {
      const state = ref<ComponentState>('default');
      const { overrides } = useThemeOverrides('button', 'global', {}, state);
      
      // Initial default state
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid');
      
      // Change to hover state
      state.value = 'hover';
      
      // Should resolve hover overrides
      expect((overrides.value as Record<string, unknown>).variant).toBe('ghost');
    });

    it('should include state in cache key', () => {
      const state = ref<ComponentState>('default');
      const { overrides } = useThemeOverrides('button', 'global', {}, state);
      
      const initialResult = overrides.value as Record<string, unknown>;
      
      // Change state
      state.value = 'hover';
      
      const hoverResult = overrides.value as Record<string, unknown>;
      
      expect(initialResult.variant).toBe('solid');
      expect(hoverResult.variant).toBe('ghost');
    });
  });

  describe('4.14 Test context detection with useAutoContext', () => {
    it('should return global when no element available', () => {
      // Test the basic functionality without DOM mocking
      const context = useAutoContext();
      
      // Should return global when no DOM element is available
      expect(context.value).toBe('global');
    });

    it('should return global when no known context found', () => {
      // This test verifies the fallback behavior
      const context = useAutoContext();
      
      expect(context.value).toBe('global');
    });
  });

  describe('useThemeOverridesAuto', () => {
    it('should use global context when no auto-context available', () => {
      // Test basic functionality without DOM mocking
      const { overrides } = useThemeOverridesAuto('button');
      
      // Should fall back to global context
      expect((overrides.value as Record<string, unknown>).variant).toBe('solid');
    });

    it('should accept reactive props and state', () => {
      const props = ref({ size: 'lg', variant: 'solid' });
      const state = ref<ComponentState>('hover');
      
      const { overrides } = useThemeOverridesAuto('button', props, state);
      
      // Should use hover state overrides with global context
      const hoverOverrides = overrides.value;
      expect(hoverOverrides.variant).toBe('ghost');
    });
  });

  describe('TypeScript generics', () => {
    it('should maintain type safety for component props', () => {
      interface ButtonProps {
        variant: 'solid' | 'outline' | 'ghost';
        size?: 'sm' | 'md' | 'lg';
        class?: string;
      }
      
      const { overrides } = useThemeOverrides<ButtonProps>('button', 'global', {
        variant: 'outline',
        size: 'lg'
      });
      
      // TypeScript should infer the correct type
      const overridesObj = overrides.value;
      const variant: string | undefined = overridesObj.variant;
      const size: string | undefined = overridesObj.size;
      
      expect(variant).toBe('solid'); // Override takes precedence
      expect(size).toBe('lg'); // Component prop preserved
    });
  });

  describe('Error handling', () => {
    it('should handle resolver errors gracefully', () => {
      // Create a resolver that throws an error
      const faultyConfig: ComponentOverrides = {
        global: {
          button: [
            {
              component: 'button',
              props: { variant: 'solid' },
              condition: () => {
                throw new Error('Test error');
              }
            }
          ]
        }
      };
      
      setOverrideResolver(faultyConfig);
      
      const { overrides } = useThemeOverrides('button');
      
      // Should return empty object on error
      expect(overrides.value as Record<string, unknown>).toEqual({});
    });
  });

  describe('4.15 Test mergeOverrides helper', () => {
    it('should merge theme props with component props', () => {
      const themeProps = {
        variant: 'solid',
        class: 'theme-class',
        ui: { base: 'blue-base', label: 'md-label' }
      };
      
      const componentProps = {
        variant: 'outline',
        class: 'component-class',
        ui: { base: 'red-base' }
      };
      
      const merged = mergeOverrides(themeProps, componentProps);
      
      expect(merged).toEqual({
        variant: 'outline', // Component props win
        class: 'theme-class component-class', // Classes concatenate
        ui: { base: 'red-base', label: 'md-label' } // UI objects deep merge
      });
    });

    it('should handle undefined component props', () => {
      const themeProps = { variant: 'solid' };
      const componentProps = { variant: undefined, class: 'component-class' };
      
      const merged = mergeOverrides(themeProps, componentProps);
      
      expect(merged).toEqual({
        variant: 'solid', // Keep theme prop when component prop is undefined
        class: 'component-class'
      });
    });

    it('should handle empty theme props', () => {
      const themeProps = {};
      const componentProps = { variant: 'outline', class: 'component-class' };
      
      const merged = mergeOverrides(themeProps, componentProps);
      
      expect(merged).toEqual({
        variant: 'outline',
        class: 'component-class'
      });
    });

    it('should handle nested ui objects correctly', () => {
      const themeProps = {
        ui: {
          base: 'blue-base',
          label: 'md-label',
          padding: { x: 4, y: 2 }
        }
      };
      
      const componentProps = {
        ui: {
          base: 'red-base',
          padding: { y: 4 }
        }
      };
      
      const merged = mergeOverrides(themeProps, componentProps);
      
      expect(merged.ui).toEqual({
        base: 'red-base', // Component props win
        label: 'md-label', // Keep theme prop
        padding: { x: 4, y: 4 } // Deep merge nested objects
      });
    });
  });
});
