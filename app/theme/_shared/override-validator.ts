/**
 * Override System Validator
 * ==========================
 * Validates component override configurations for structure and type safety.
 * Provides detailed error messages for debugging theme configurations.
 */

import type { 
  ComponentOverrides, 
  OverrideRule, 
  ComponentType 
} from './override-types';

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validates component override configuration
 * 
 * @param overrides - Component overrides configuration to validate
 * @returns Validation result with errors and warnings
 */
export function validateComponentOverrides(
  overrides: unknown
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // 6.3 Check override config structure
  if (!overrides || typeof overrides !== 'object') {
    errors.push({
      path: 'componentOverrides',
      message: 'componentOverrides must be an object',
      severity: 'error',
    });
    return { valid: false, errors, warnings };
  }

  const config = overrides as Record<string, unknown>;

  // Validate global overrides
  if (config.global !== undefined) {
    validateGlobalOverrides(config.global, errors, warnings);
  }

  // Validate context overrides
  if (config.contexts !== undefined) {
    validateContextOverrides(config.contexts, errors, warnings);
  }

  // Validate state overrides
  if (config.states !== undefined) {
    validateStateOverrides(config.states, errors, warnings);
  }

  // Validate identifier overrides
  if (config.identifiers !== undefined) {
    validateIdentifierOverrides(config.identifiers, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates identifier override configuration
 */
function validateIdentifierOverrides(
  identifiers: unknown,
  errors: ValidationError[],
  warnings: ValidationError[],
): void {
  if (typeof identifiers !== 'object' || identifiers === null) {
    errors.push({
      path: 'componentOverrides.identifiers',
      message: 'identifier overrides must be an object',
      severity: 'error',
    });
    return;
  }

  const identifiersObj = identifiers as Record<string, unknown>;

  for (const [identifier, config] of Object.entries(identifiersObj)) {
    const identifierPath = `componentOverrides.identifiers.${identifier}`;

    if (typeof config !== 'object' || config === null) {
      errors.push({
        path: identifierPath,
        message: `identifier "${identifier}" override must be an object`,
        severity: 'error',
      });
      continue;
    }

    const cfg = config as Record<string, unknown>;

    if (cfg.variant !== undefined && typeof cfg.variant !== 'string') {
      errors.push({
        path: `${identifierPath}.variant`,
        message: 'variant must be a string',
        severity: 'error',
      });
    }

    if (cfg.size !== undefined && typeof cfg.size !== 'string') {
      errors.push({
        path: `${identifierPath}.size`,
        message: 'size must be a string',
        severity: 'error',
      });
    }

    if (cfg.color !== undefined && typeof cfg.color !== 'string') {
      errors.push({
        path: `${identifierPath}.color`,
        message: 'color must be a string',
        severity: 'error',
      });
    }

    if (cfg.class !== undefined && typeof cfg.class !== 'string') {
      errors.push({
        path: `${identifierPath}.class`,
        message: 'class must be a string',
        severity: 'error',
      });
    }

    if (cfg.ui !== undefined && (typeof cfg.ui !== 'object' || cfg.ui === null)) {
      errors.push({
        path: `${identifierPath}.ui`,
        message: 'ui must be an object when provided',
        severity: 'error',
      });
    }
  }
}

/**
 * Validates global override configuration
 */
function validateGlobalOverrides(
  global: unknown,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof global !== 'object' || global === null) {
    errors.push({
      path: 'componentOverrides.global',
      message: 'global overrides must be an object',
      severity: 'error',
    });
    return;
  }

  const globalObj = global as Record<string, unknown>;

  for (const [component, rules] of Object.entries(globalObj)) {
    const componentPath = `componentOverrides.global.${component}`;

    // 6.4 Validate global overrides are arrays
    if (!Array.isArray(rules)) {
      errors.push({
        path: componentPath,
        message: `${component} global overrides must be an array`,
        severity: 'error',
      });
      continue;
    }

    // Validate each rule in the array
    rules.forEach((rule, index) => {
      validateOverrideRule(rule, `${componentPath}[${index}]`, errors, warnings);
    });
  }
}

/**
 * Validates context override configuration
 */
function validateContextOverrides(
  contexts: unknown,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof contexts !== 'object' || contexts === null) {
    errors.push({
      path: 'componentOverrides.contexts',
      message: 'context overrides must be an object',
      severity: 'error',
    });
    return;
  }

  const contextsObj = contexts as Record<string, unknown>;

  for (const [context, contextOverrides] of Object.entries(contextsObj)) {
    const contextPath = `componentOverrides.contexts.${context}`;

    // 6.5 Validate context overrides are objects
    if (typeof contextOverrides !== 'object' || contextOverrides === null) {
      errors.push({
        path: contextPath,
        message: `context "${context}" overrides must be an object`,
        severity: 'error',
      });
      continue;
    }

    const contextObj = contextOverrides as Record<string, unknown>;

    for (const [component, rules] of Object.entries(contextObj)) {
      const componentPath = `${contextPath}.${component}`;

      if (!Array.isArray(rules)) {
        errors.push({
          path: componentPath,
          message: `${component} overrides in context "${context}" must be an array`,
          severity: 'error',
        });
        continue;
      }

      // Validate each rule in the array
      rules.forEach((rule, index) => {
        validateOverrideRule(rule, `${componentPath}[${index}]`, errors, warnings);
      });
    }
  }
}

/**
 * Validates state override configuration
 */
function validateStateOverrides(
  states: unknown,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof states !== 'object' || states === null) {
    errors.push({
      path: 'componentOverrides.states',
      message: 'state overrides must be an object',
      severity: 'error',
    });
    return;
  }

  const statesObj = states as Record<string, unknown>;

  for (const [state, stateOverrides] of Object.entries(statesObj)) {
    const statePath = `componentOverrides.states.${state}`;

    if (typeof stateOverrides !== 'object' || stateOverrides === null) {
      errors.push({
        path: statePath,
        message: `state "${state}" overrides must be an object`,
        severity: 'error',
      });
      continue;
    }

    const stateObj = stateOverrides as Record<string, unknown>;

    for (const [component, rules] of Object.entries(stateObj)) {
      const componentPath = `${statePath}.${component}`;

      if (!Array.isArray(rules)) {
        errors.push({
          path: componentPath,
          message: `${component} overrides in state "${state}" must be an array`,
          severity: 'error',
        });
        continue;
      }

      // Validate each rule in the array
      rules.forEach((rule, index) => {
        validateOverrideRule(rule, `${componentPath}[${index}]`, errors, warnings);
      });
    }
  }
}

/**
 * Validates individual override rule structure
 */
function validateOverrideRule(
  rule: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (!rule || typeof rule !== 'object') {
    errors.push({
      path,
      message: 'override rule must be an object',
      severity: 'error',
    });
    return;
  }

  const ruleObj = rule as Record<string, unknown>;

  // 6.6 Validate rule structure (component, props, etc.)
  
  // Validate component property
  if (ruleObj.component === undefined) {
    errors.push({
      path: `${path}.component`,
      message: 'override rule must have a component property',
      severity: 'error',
    });
  } else if (typeof ruleObj.component !== 'string') {
    errors.push({
      path: `${path}.component`,
      message: 'component property must be a string',
      severity: 'error',
    });
  }

  // Validate props property
  if (ruleObj.props === undefined) {
    errors.push({
      path: `${path}.props`,
      message: 'override rule must have a props property',
      severity: 'error',
    });
  } else if (typeof ruleObj.props !== 'object' || ruleObj.props === null) {
    errors.push({
      path: `${path}.props`,
      message: 'props property must be an object',
      severity: 'error',
    });
  }

  // Validate priority property (optional)
  if (ruleObj.priority !== undefined) {
    if (typeof ruleObj.priority !== 'number') {
      errors.push({
        path: `${path}.priority`,
        message: 'priority property must be a number',
        severity: 'error',
      });
    } else if (ruleObj.priority < 0) {
      warnings.push({
        path: `${path}.priority`,
        message: 'priority should be a non-negative number',
        severity: 'warning',
      });
    }
  }

  // Validate condition property (optional)
  if (ruleObj.condition !== undefined) {
    if (typeof ruleObj.condition !== 'function') {
      errors.push({
        path: `${path}.condition`,
        message: 'condition property must be a function',
        severity: 'error',
      });
    }
  }
}

/**
 * Logs validation errors to console with proper formatting
 * 
 * @param result - Validation result to log
 * @param context - Context for the validation (e.g., theme name)
 */
export function logValidationErrors(
  result: ValidationResult,
  context: string = 'theme'
): void {
  if (result.errors.length === 0 && result.warnings.length === 0) {
    return;
  }

  console.group(`[theme] Validation results for ${context}`);
  
  // Log errors
  if (result.errors.length > 0) {
    console.error(`❌ ${result.errors.length} validation error(s):`);
    result.errors.forEach(error => {
      console.error(`  ${error.path}: ${error.message}`);
    });
  }

  // Log warnings
  if (result.warnings.length > 0) {
    console.warn(`⚠️  ${result.warnings.length} validation warning(s):`);
    result.warnings.forEach(warning => {
      console.warn(`  ${warning.path}: ${warning.message}`);
    });
  }

  console.groupEnd();
}

/**
 * Checks if a component type is valid
 * 
 * @param component - Component type to check
 * @returns True if component type is recognized
 */
export function isValidComponentType(component: string): boolean {
  const knownComponents: ComponentType[] = [
    'button',
    'input', 
    'textarea',
    'modal',
    'card',
    'badge',
    'tooltip',
    'dropdown',
  ];

  return knownComponents.includes(component as ComponentType) || 
         /^[a-z][a-zA-Z0-9]*$/.test(component);
}
