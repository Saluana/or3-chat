import type { 
  ComponentOverrides, 
  OverrideRule, 
  ResolvedOverride, 
  OverrideContext,
  ComponentType,
  ContextSelector 
} from './override-types';

/**
 * Simple LRU cache implementation
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
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
    if (this.cache.has(key)) {
      // Update existing
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
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

  keys(): K[] {
    return Array.from(this.cache.keys());
  }
}

export class OverrideResolver {
  private overrides: ComponentOverrides;
  private cache: LRUCache<string, ResolvedOverride>;
  
  constructor(overrides: ComponentOverrides) {
    this.overrides = overrides;
    this.cache = new LRUCache<string, ResolvedOverride>(100);
  }
  
  /**
   * Resolve overrides for a component
   */
  resolve(
    componentType: ComponentType,
    context: ContextSelector,
    overrideContext: OverrideContext
  ): ResolvedOverride {
    // Generate cache key
    const cacheKey = this.getCacheKey(componentType, context, overrideContext);
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Collect applicable rules
    const rules = this.collectRules(componentType, context, overrideContext);
    
    // Sort by priority (higher priority wins)
    rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    
    // Merge props from all rules
    const props = this.mergeProps(rules);
    
    // Cache result
    const result: ResolvedOverride = {
      props,
      rules,
      cacheKey,
    };
    
    this.cache.set(cacheKey, result);
    
    return result;
  }
  
  /**
   * Collect all applicable override rules
   */
  private collectRules(
    componentType: ComponentType,
    context: ContextSelector,
    overrideContext: OverrideContext
  ): OverrideRule[] {
    const rules: OverrideRule[] = [];
    
    // 1. Global overrides (lowest priority)
    if (this.overrides.global?.[componentType]) {
      rules.push(...this.overrides.global[componentType]);
    }
    
    // 2. Context-specific overrides
    if (context !== 'global' && this.overrides.contexts?.[context]?.[componentType]) {
      rules.push(...this.overrides.contexts[context][componentType]);
    }
    
    // 3. State-based overrides (highest priority)
    // Use explicit reactive state from context
    const componentState = overrideContext.state ?? 'default';
    if (this.overrides.states?.[componentState]?.[componentType]) {
      rules.push(...this.overrides.states[componentState][componentType]);
    }
    
    // 4. Filter by condition
    return rules.filter(rule => {
      if (!rule.condition) return true;
      return rule.condition(overrideContext);
    });
  }
  
  /**
   * Merge props from multiple rules
   */
  private mergeProps(rules: OverrideRule[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    
    for (const rule of rules) {
      for (const [key, value] of Object.entries(rule.props)) {
        if (key === 'class') {
          // Concatenate classes
          merged[key] = merged[key] 
            ? `${merged[key]} ${value}` 
            : value;
        } else if (key === 'ui' && typeof value === 'object') {
          // Deep merge ui objects
          merged[key] = this.deepMerge(merged[key] as Record<string, unknown> ?? {}, value as Record<string, unknown>);
        } else {
          // Override with latest value
          merged[key] = value;
        }
      }
    }
    
    return merged;
  }
  
  /**
   * Deep merge objects
   */
  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deepMerge(result[key] as Record<string, unknown> ?? {}, value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }
  
  /**
   * Generate cache key
   */
  private getCacheKey(
    componentType: ComponentType,
    context: ContextSelector,
    overrideContext: OverrideContext
  ): string {
    // Include component props in cache key to ensure different props get different caches
    const propsHash = this.hashObject(overrideContext.componentProps);
    // Include element identifier if available (for state-based conditions)
    const elementId = overrideContext.element?.id || overrideContext.element?.className || 'no-element';
    // Include explicit reactive state from context
    const componentState = overrideContext.state ?? 'default';
    
    return `${componentType}:${context}:${overrideContext.mode}:${overrideContext.theme}:${componentState}:${propsHash}:${elementId}`;
  }

  /**
   * Simple hash function for objects
   */
  private hashObject(obj: Record<string, unknown>): string {
    // Recursively sort object keys to ensure consistent hashing
    const sortedObj = this.sortObjectKeys(obj);
    const str = JSON.stringify(sortedObj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Recursively sort object keys for consistent hashing
   */
  private sortObjectKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObjectKeys(item));
    }
    
    const sortedObj: Record<string, any> = {};
    const keys = Object.keys(obj).sort();
    
    for (const key of keys) {
      sortedObj[key] = this.sortObjectKeys(obj[key]);
    }
    
    return sortedObj;
  }
  
  /**
   * Clear cache (call on theme switch)
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache statistics (for debugging)
   */
  getCacheStats(): { size: number; keys: string[]; maxSize: number } {
    return {
      size: this.cache.size,
      keys: this.cache.keys(),
      maxSize: 100,
    };
  }
}

/**
 * Singleton resolver instance
 */
let resolverInstance: OverrideResolver | null = null;

export function getOverrideResolver(): OverrideResolver | null {
  return resolverInstance;
}

export function setOverrideResolver(overrides: ComponentOverrides): void {
  resolverInstance = new OverrideResolver(overrides);
}

export function clearOverrideResolver(): void {
  resolverInstance?.clearCache();
  resolverInstance = null;
}
