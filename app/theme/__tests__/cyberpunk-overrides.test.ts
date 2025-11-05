/**
 * Cyberpunk Theme Override Tests
 * ===============================
 * Tests that the cyberpunk theme correctly applies component overrides
 * with neon colors, glow effects, and cyberpunk styling.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { setOverrideResolver, clearOverrideResolver, getOverrideResolver } from '~/theme/_shared/override-resolver';

let cyberpunkTheme: any;

// Mock defineAppConfig for theme config loading
beforeAll(async () => {
    (globalThis as any).defineAppConfig = (config: any) => config;
    // Import theme after mocking defineAppConfig
    cyberpunkTheme = await import('../cyberpunk/theme');
});

describe('Cyberpunk Theme Overrides', () => {
  beforeEach(() => {
    // Set up the cyberpunk theme overrides
    if (cyberpunkTheme.default?.componentOverrides) {
      setOverrideResolver(cyberpunkTheme.default.componentOverrides);
    }
  });

  afterEach(() => {
    clearOverrideResolver();
  });

  describe('Global Button Overrides', () => {
    it('should apply cyberpunk solid styling to buttons', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props).toMatchObject({
        variant: 'neonSolid', // Higher priority (1) wins over cyberpunkSolid (0)
        size: 'md',
        class: expect.stringContaining('shadow-[0_0_20px_rgba(255,0,255,0.5)]')
      });
    });

    it('should apply neon glow effects', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props.class).toContain('hover:shadow-[0_0_30px_rgba(255,0,255,0.8)]');
    });
  });

  describe('Global Input Overrides', () => {
    it('should apply cyberpunk styling to inputs', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('input', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props).toMatchObject({
        variant: 'cyberpunk',
        size: 'md',
        class: expect.stringContaining('bg-black border-2 border-cyan-400 text-cyan-400')
      });
    });

    it('should apply neon glow effects to inputs', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('input', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props.class).toContain('shadow-[0_0_15px_rgba(0,255,255,0.3)]');
      expect(result?.props.class).toContain('focus:shadow-[0_0_25px_rgba(0,255,255,0.6)]');
    });
  });

  describe('Global Modal Overrides', () => {
    it('should apply cyberpunk styling to modals', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('modal', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props).toMatchObject({
        class: expect.stringContaining('bg-gradient-to-br from-gray-900 via-purple-900/20 to-black')
      });
      expect(result?.props.class).toContain('border-[3px] border-cyan-400');
      expect(result?.props.class).toContain('shadow-[0_0_50px_rgba(0,255,255,0.8)]');
    });
  });

  describe('Context-Specific Overrides', () => {
    it('should apply neon outline buttons in chat context', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'chat', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props).toMatchObject({
        variant: 'neonOutline', // Context override (priority 2) wins
        size: 'sm',
        class: expect.stringContaining('border-pink-500 text-pink-500')
      });
    });

    it('should apply cyberpunk outline buttons in sidebar context', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'sidebar', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: {}
      });

      expect(result?.props).toMatchObject({
        variant: 'cyberpunkOutline', // Context override (priority 2) wins
        size: 'sm',
        class: expect.stringContaining('border-cyan-400 text-cyan-400')
      });
    });
  });

  describe('State-Based Overrides', () => {
    it('should apply enhanced glow effects on hover', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'hover',
        componentProps: {}
      });

      expect(result?.props.class).toContain('hover:shadow-[0_0_40px_rgba(0,255,255,1)]');
      expect(result?.props.class).toContain('hover:scale-105');
      expect(result?.props.class).toContain('transition-all duration-200');
    });

    it('should apply disabled state styling', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'disabled',
        componentProps: {}
      });

      expect(result?.props).toMatchObject({
        variant: 'ghost', // Disabled state (priority 4) wins
        class: expect.stringContaining('opacity-50 cursor-not-allowed shadow-none')
      });
    });
  });

  describe('Props Win Principle', () => {
    it('should respect explicit component props over theme overrides', () => {
      const resolver = getOverrideResolver();
      if (!resolver) {
        throw new Error('Resolver not initialized');
      }

      const result = resolver.resolve('button', 'global', {
        mode: 'light',
        theme: 'cyberpunk',
        state: 'default',
        componentProps: { variant: 'custom', size: 'lg' }
      });

      expect(result?.props).toMatchObject({
        variant: 'custom', // Component props win
        size: 'lg', // Component props win
        class: expect.stringContaining('shadow-[0_0_20px_rgba(255,0,255,0.5)]') // Theme class still applies
      });
    });
  });
});
