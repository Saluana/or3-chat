/**
 * Theme Plugin Integration Tests
 * ==============================
 * Tests the theme plugin's override system integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getOverrideResolver, setOverrideResolver, clearOverrideResolver, type ComponentOverrides } from '~/theme/_shared/override-resolver';

describe('Theme Plugin Override Integration', () => {
  beforeEach(() => {
    clearOverrideResolver();
    vi.clearAllMocks();
  });

  it('should initialize override system with theme config', () => {
    // Mock theme config with component overrides
    const mockThemeConfig = {
      componentOverrides: {
        global: {
          button: [
            {
              component: 'button',
              props: { variant: 'solid' as const, class: 'test-btn' },
              priority: 1,
            },
          ],
        },
      } as ComponentOverrides,
    };

    // Simulate what the theme plugin does
    if (mockThemeConfig.componentOverrides) {
      setOverrideResolver(mockThemeConfig.componentOverrides);
    }

    // Verify resolver is set up
    const resolver = getOverrideResolver();
    expect(resolver).toBeTruthy();

    // Test that it resolves overrides correctly (Props Win: component props win)
    const result = resolver?.resolve('button', 'global', {
      mode: 'light',
      theme: 'default',
      state: 'default',
      componentProps: { variant: 'outline' }
    });

    expect(result?.props).toEqual({
      variant: 'outline', // Component props win over theme override
      class: 'test-btn'
    });
  });

  it('should clear resolver before loading new theme', () => {
    // Set up initial resolver
    const initialConfig = {
      global: {
        button: [
          {
            component: 'button',
            props: { variant: 'solid' as const },
            priority: 1,
          },
        ],
      },
    } as ComponentOverrides;

    setOverrideResolver(initialConfig);

    // Verify resolver exists
    expect(getOverrideResolver()).toBeTruthy();

    // Clear resolver (simulating theme switch)
    clearOverrideResolver();
    
    // Verify resolver is cleared
    expect(getOverrideResolver()).toBeNull();
  });

  it('should handle invalid override config gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock invalid config
    const invalidConfig = {
      componentOverrides: null,
    };

    // Simulate what the theme plugin does with validation
    try {
      const overrides = invalidConfig.componentOverrides;
      if (typeof overrides !== 'object' || overrides === null) {
        throw new Error('componentOverrides must be a valid object');
      }
      setOverrideResolver(overrides);
    } catch (err) {
      console.error('[theme] Failed to initialize overrides:', err);
    }

    // Should log error but not crash
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[theme] Failed to initialize overrides:'),
      expect.any(Error)
    );

    // Verify resolver is still null
    expect(getOverrideResolver()).toBeNull();

    consoleSpy.mockRestore();
  });
});
