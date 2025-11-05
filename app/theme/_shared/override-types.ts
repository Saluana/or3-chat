import type { ButtonProps, InputProps, ModalProps, CardProps } from '@nuxt/ui';

/**
 * Context selector for targeting specific UI areas
 */
export type ContextSelector = 
  | 'global'       // Apply to all components
  | 'chat'         // Apply within #app-chat-container
  | 'sidebar'      // Apply within #app-sidebar
  | 'dashboard'    // Apply within #app-dashboard-modal
  | 'header'       // Apply within #app-header
  | string;        // Custom CSS selector

/**
 * Component type for targeting specific Nuxt UI components
 */
export type ComponentType = 
  | 'button' 
  | 'input' 
  | 'textarea'
  | 'modal' 
  | 'card'
  | 'badge'
  | 'tooltip'
  | 'dropdown'
  | string;        // Any Nuxt UI component name

/**
 * Component state for state-based overrides
 */
export type ComponentState = 
  | 'default'
  | 'hover'
  | 'active'
  | 'disabled'
  | 'loading'
  | 'focus';

/**
 * Override rule defines what props to apply to which components
 */
export interface OverrideRule<TProps = Record<string, unknown>> {
  /** Component type to target */
  component: ComponentType;
  
  /** Context selector (default: 'global') */
  context?: ContextSelector;
  
  /** State to apply overrides (default: 'default') */
  state?: ComponentState;
  
  /** Props to override */
  props: Partial<TProps>;
  
  /** Optional priority (higher wins, default: 0) */
  priority?: number;
  
  /** Optional condition function */
  condition?: (context: OverrideContext) => boolean;
}

/**
 * Context information passed to condition functions
 */
export interface OverrideContext {
  /** Current theme mode */
  mode: 'light' | 'dark' | 'light-hc' | 'dark-hc' | 'light-mc' | 'dark-mc';
  
  /** Active theme name */
  theme: string;
  
  /** Component element (if available) */
  element?: HTMLElement;
  
  /** Component props */
  componentProps: Record<string, unknown>;
}

/**
 * Component overrides configuration in theme.ts
 */
export interface ComponentOverrides {
  /** Global overrides (apply to all instances) */
  global?: {
    button?: OverrideRule<ButtonProps>[];
    input?: OverrideRule<InputProps>[];
    modal?: OverrideRule<ModalProps>[];
    card?: OverrideRule<CardProps>[];
    // Additional components can be added with this type
    [key: string]: OverrideRule<Record<string, unknown>>[] | undefined;
  };
  
  /** Context-specific overrides */
  contexts?: {
    chat?: ComponentOverrides['global'];
    sidebar?: ComponentOverrides['global'];
    dashboard?: ComponentOverrides['global'];
    header?: ComponentOverrides['global'];
    [key: string]: ComponentOverrides['global'];
  };
  
  /** State-based overrides */
  states?: {
    hover?: ComponentOverrides['global'];
    active?: ComponentOverrides['global'];
    disabled?: ComponentOverrides['global'];
    loading?: ComponentOverrides['global'];
    focus?: ComponentOverrides['global'];
    [key: string]: ComponentOverrides['global'];
  };
}

/**
 * Resolved override result
 */
export interface ResolvedOverride {
  /** Merged props to apply */
  props: Record<string, unknown>;
  
  /** Applied rules (for debugging) */
  rules: OverrideRule[];
  
  /** Cache key */
  cacheKey: string;
}
