import { Validator, dereference, type OutputUnit, type Schema } from '@cfworker/json-schema';
import draft7 from 'ajv/dist/refs/json-schema-draft-07.json';

export type JsonSchemaObject = Record<string, unknown> & {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
};

export interface ToolDefinitionShape {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: JsonSchemaObject;
    };
}

export type ToolValidationResult<T> =
    | { valid: true; value: T }
    | { valid: false; error: string };

// Interpret schemas in both runtimes; runtime code generation violates the
// production CSP. Only the static draft-07 metadata is imported from Ajv.
let metaValidator: Validator | undefined;
const validators = new WeakMap<object, Validator>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatErrors(errors: OutputUnit[]): string {
    if (!errors.length) return 'value does not match the JSON Schema';
    return errors.map((error) => `${error.instanceLocation.replace(/^#/, '') || '/'} ${error.error}`).join('; ');
}

/** Check schema keywords, visiting only schema locations, never enum/default data. */
function prepareSchema(schema: Schema | boolean): void {
    if (typeof schema === 'boolean') return;
    for (const key of Object.keys(schema)) {
        if (!Object.hasOwn(draft7.properties, key) && key !== '$defs') {
            throw new Error(`Unknown JSON Schema keyword "${key}".`);
        }
    }
    if (schema.$schema && schema.$schema.replace(/#$/, '') !== draft7.$id.replace(/#$/, '')) {
        throw new Error('Tool schemas must use JSON Schema draft-07.');
    }
    if (schema.pattern !== undefined) new RegExp(schema.pattern, 'u');
    for (const pattern of Object.keys(schema.patternProperties ?? {})) new RegExp(pattern, 'u');
    // Preserve the existing validateFormats:false contract. Formats annotate
    // tool inputs; constraints such as pattern/minLength still validate them.
    delete schema.format;
    for (const key of ['definitions', '$defs', 'properties', 'patternProperties', 'dependencies']) {
        for (const child of Object.values(schema[key] ?? {})) {
            if (Array.isArray(child)) continue;
            if (key === '$defs' && !metaValidator!.validate(child).valid) {
                throw new Error('Invalid JSON Schema in $defs.');
            }
            prepareSchema(child as Schema | boolean);
        }
    }
    for (const key of ['additionalItems', 'items', 'contains', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else', 'allOf', 'anyOf', 'oneOf']) {
        const child = schema[key] as Schema | boolean | (Schema | boolean)[] | undefined;
        if (Array.isArray(child)) child.forEach(prepareSchema);
        else if (child !== undefined) prepareSchema(child);
    }
}

function getValidator(schema: JsonSchemaObject): ToolValidationResult<Validator> {
    const cached = validators.get(schema);
    if (cached) return { valid: true, value: cached };
    try {
        metaValidator ??= new Validator(draft7 as Schema, '7', false);
        const checked = metaValidator.validate(schema);
        if (!checked.valid) return { valid: false, error: `Invalid JSON Schema: ${formatErrors(checked.errors)}` };
        // The interpreter resolves references by annotating schemas. Clone so
        // frozen plugin definitions and admission snapshots remain untouched.
        const prepared = structuredClone(schema) as Schema;
        prepareSchema(prepared);
        const lookup = dereference(prepared);
        for (const child of Object.values(lookup)) {
            if (typeof child === 'object' && child.__absolute_ref__ && lookup[child.__absolute_ref__] === undefined) {
                throw new Error(`Unresolved $ref "${child.$ref}".`);
            }
        }
        const validator = new Validator(prepared, '7', false);
        validators.set(schema, validator);
        return { valid: true, value: validator };
    } catch (error) {
        return { valid: false, error: `Invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}` };
    }
}

/** Validate a provider-visible tool definition and its parameter schema. */
export function validateToolDefinition(
    value: unknown
): ToolValidationResult<ToolDefinitionShape> {
    if (!isRecord(value) || value.type !== 'function' || !isRecord(value.function)) {
        return { valid: false, error: 'Tool definition must describe a function.' };
    }

    const fn = value.function;
    if (typeof fn.name !== 'string' || fn.name.trim().length === 0) {
        return { valid: false, error: 'Tool function name must be a non-empty string.' };
    }
    if (typeof fn.description !== 'string') {
        return { valid: false, error: `Tool "${fn.name}" description must be a string.` };
    }
    if (!isRecord(fn.parameters) || fn.parameters.type !== 'object') {
        return {
            valid: false,
            error: `Tool "${fn.name}" parameters must be an object JSON Schema.`,
        };
    }

    const schema = fn.parameters as JsonSchemaObject;
    const validator = getValidator(schema);
    if (!validator.valid) {
        return { valid: false, error: `Tool "${fn.name}": ${validator.error}` };
    }

    return { valid: true, value: value as unknown as ToolDefinitionShape };
}

/** Validate a complete request tool list, including duplicate-name rejection. */
export function validateToolDefinitions(
    value: unknown
): ToolValidationResult<ToolDefinitionShape[]> {
    if (!Array.isArray(value)) {
        return { valid: false, error: 'Request tools must be an array.' };
    }

    const definitions: ToolDefinitionShape[] = [];
    const names = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const result = validateToolDefinition(value[index]);
        if (!result.valid) {
            return { valid: false, error: `tools[${index}]: ${result.error}` };
        }
        const name = result.value.function.name;
        if (names.has(name)) {
            return { valid: false, error: `Duplicate tool definition "${name}".` };
        }
        names.add(name);
        definitions.push(result.value);
    }
    return { valid: true, value: definitions };
}

/** Parse and validate one tool call using the same code in both runtimes. */
export function validateToolArguments(
    json: string,
    schema: JsonSchemaObject
): ToolValidationResult<Record<string, unknown>> {
    let value: unknown;
    try {
        value = JSON.parse(json);
    } catch (error) {
        return {
            valid: false,
            error: `Failed to parse JSON arguments: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    if (!isRecord(value)) {
        return { valid: false, error: 'Arguments must be a JSON object.' };
    }

    const validator = getValidator(schema);
    if (!validator.valid) return validator;
    const checked = validator.value.validate(value);
    if (!checked.valid) {
        return {
            valid: false,
            error: `Invalid tool arguments: ${formatErrors(checked.errors)}`,
        };
    }
    return { valid: true, value };
}
