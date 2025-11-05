import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OverrideResolver, setOverrideResolver, getOverrideResolver, clearOverrideResolver } from '../override-resolver';
import type { ComponentOverrides, OverrideRule, OverrideContext } from '../override-types';

// Define test interfaces to avoid type conflicts
interface TestButtonProps {
  variant?: string;
  class?: string;
  ui?: {
    color?: string;
    size?: string;
  };
}

describe('OverrideResolver', () => {
  let resolver: OverrideResolver;
  let testConfig: ComponentOverrides;

  beforeEach(() => {
    testConfig = {
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

    resolver = new OverrideResolver(testConfig);
  });

  afterEach(() => {
    clearOverrideResolver();
  });

  describe('4.2 Test resolver initializes with config', () => {
    it('should initialize with provided config', () => {
      expect(resolver).toBeDefined();
      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(100);
    });
  });

  describe('4.3 Test global override resolution', () => {
    it('should resolve global overrides', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = resolver.resolve('button', 'global', context);

      expect(result.props).toEqual({
        variant: 'solid',
        class: 'global-btn'
      });
      expect(result.rules).toHaveLength(1);
      expect(result.cacheKey).toContain('button:global:light:default');
    });
  });

  describe('4.4 Test context-specific override resolution', () => {
    it('should resolve context-specific overrides with higher priority', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = resolver.resolve('button', 'chat', context);

      expect(result.props).toEqual({
        variant: 'outline',
        class: 'chat-btn global-btn'
      });
      expect(result.rules).toHaveLength(2); // global + context
    });
  });

  describe('4.5 Test priority ordering (higher priority wins)', () => {
    it('should apply higher priority rules last', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = resolver.resolve('button', 'chat', context);

      // Context rule (priority 1) should override global rule (priority 0)
      expect(result.props.variant).toBe('outline');
      // Classes should concatenate
      expect(result.props.class).toBe('chat-btn global-btn');
    });
  });

  describe('4.6 Test condition filtering', () => {
    it('should filter rules based on conditions', () => {
      const configWithCondition: ComponentOverrides = {
        global: {
          button: [
            {
              component: 'button',
              props: { variant: 'solid' }, // Use valid variant
              priority: 10,
              condition: (ctx: OverrideContext) => ctx.theme === 'special'
            },
            {
              component: 'button',
              props: { variant: 'outline' }, // Use valid variant
              priority: 0
            }
          ]
        }
      };

      const conditionalResolver = new OverrideResolver(configWithCondition);
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = conditionalResolver.resolve('button', 'global', context);

      expect(result.props.variant).toBe('outline');
    });

    it('should apply conditional rules when condition is met', () => {
      const configWithCondition: ComponentOverrides = {
        global: {
          button: [
            {
              component: 'button',
              props: { variant: 'solid' }, // Use valid variant
              priority: 10,
              condition: (ctx: OverrideContext) => ctx.theme === 'special'
            },
            {
              component: 'button',
              props: { variant: 'outline' }, // Use valid variant
              priority: 0
            }
          ]
        }
      };

      const conditionalResolver = new OverrideResolver(configWithCondition);
      const context: OverrideContext = {
        mode: 'light',
        theme: 'special',
        componentProps: {}
      };

      const result = conditionalResolver.resolve('button', 'global', context);

      expect(result.props.variant).toBe('solid');
    });
  });

  describe('4.7 Test prop merging (class concatenation, ui deep merge)', () => {
    it('should concatenate classes', () => {
      const config: ComponentOverrides = {
        global: {
          button: [
            {
              component: 'button',
              props: { class: 'first' },
              priority: 0
            },
            {
              component: 'button',
              props: { class: 'second' },
              priority: 1
            }
          ]
        }
      };

      const classResolver = new OverrideResolver(config);
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = classResolver.resolve('button', 'global', context);

      expect(result.props.class).toBe('second first');
    });

    it('should deep merge ui objects', () => {
      const config: ComponentOverrides = {
        global: {
          button: [
            {
              component: 'button',
              props: { ui: { base: 'red-base', label: 'md-label' } },
              priority: 0
            },
            {
              component: 'button',
              props: { ui: { base: 'blue-base' } },
              priority: 1
            }
          ]
        }
      };

      const uiResolver = new OverrideResolver(config);
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = uiResolver.resolve('button', 'global', context);

      expect(result.props.ui).toEqual({
        base: 'blue-base',
        label: 'md-label'
      });
    });
  });

  describe('4.8 Test cache hit/miss behavior', () => {
    it('should cache resolved overrides', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      // First call should be a cache miss
      const result1 = resolver.resolve('button', 'global', context);
      expect(resolver.getCacheStats().size).toBe(1);

      // Second call with same params should be a cache hit
      const result2 = resolver.resolve('button', 'global', context);
      expect(resolver.getCacheStats().size).toBe(1);
      expect(result1).toBe(result2); // Same cached object
    });

    it('should create separate cache entries for different states', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {},
        state: 'default'
      };

      const hoverContext: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {},
        state: 'hover'
      };

      resolver.resolve('button', 'global', context);
      resolver.resolve('button', 'global', hoverContext);

      expect(resolver.getCacheStats().size).toBe(2);
    });
  });

  describe('4.9 Test cache clearing on theme switch', () => {
    it('should clear cache when requested', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      resolver.resolve('button', 'global', context);
      expect(resolver.getCacheStats().size).toBe(1);

      resolver.clearCache();
      expect(resolver.getCacheStats().size).toBe(0);
    });
  });

  describe('State-based overrides', () => {
    it('should use explicit state from context', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {},
        state: 'hover'
      };

      const result = resolver.resolve('button', 'global', context);

      expect(result.props.variant).toBe('ghost');
      expect(result.props.class).toBe('hover-btn global-btn');
    });

    it('should default to default state when no state provided', () => {
      const context: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: {}
      };

      const result = resolver.resolve('button', 'global', context);

      expect(result.props.variant).toBe('solid');
    });
  });

  describe('Cache key generation', () => {
    it('should include component props in cache key', () => {
      const context1: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: { variant: 'solid' }
      };

      const context2: OverrideContext = {
        mode: 'light',
        theme: 'default',
        componentProps: { variant: 'outline' }
      };

      const result1 = resolver.resolve('button', 'global', context1);
      const result2 = resolver.resolve('button', 'global', context2);

      expect(resolver.getCacheStats().size).toBe(2);
      expect(result1.cacheKey).not.toBe(result2.cacheKey);
    });
  });
});

describe('Singleton resolver management', () => {
  afterEach(() => {
    clearOverrideResolver();
  });

  it('should set and get singleton resolver', () => {
    const config: ComponentOverrides = {
      global: {
        button: [
          {
            component: 'button',
            props: { variant: 'solid' }
          }
        ]
      }
    };

    setOverrideResolver(config);
    const resolver = getOverrideResolver();
    
    expect(resolver).toBeDefined();
    expect(resolver).toBeInstanceOf(OverrideResolver);
  });

  it('should return null when no resolver set', () => {
    const resolver = getOverrideResolver();
    expect(resolver).toBeNull();
  });
});
