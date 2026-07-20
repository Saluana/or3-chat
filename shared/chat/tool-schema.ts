import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

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

// One validator instance is shared by browser and server imports. Ajv's default
// dialect is JSON Schema draft-07, which is the dialect accepted by the tool API.
const ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateFormats: false,
});

const compiledSchemas = new WeakMap<object, ValidateFunction>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(error: ErrorObject): string {
    const path = error.instancePath || '/';
    if (error.keyword === 'required') {
        const missing = (error.params as { missingProperty?: string }).missingProperty;
        return missing ? `${path === '/' ? '' : path}/${missing}` || '/' : path;
    }
    if (error.keyword === 'additionalProperties') {
        const extra = (error.params as { additionalProperty?: string }).additionalProperty;
        return extra ? `${path === '/' ? '' : path}/${extra}` || '/' : path;
    }
    return path;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors?.length) return 'value does not match the JSON Schema';
    return errors
        .map((error) => `${formatPath(error)} ${error.message ?? error.keyword}`)
        .join('; ');
}

function compileSchema(schema: JsonSchemaObject): ToolValidationResult<ValidateFunction> {
    const cached = compiledSchemas.get(schema);
    if (cached) return { valid: true, value: cached };

    try {
        const validSchema = ajv.validateSchema(schema);
        if (!validSchema) {
            return {
                valid: false,
                error: `Invalid JSON Schema: ${formatErrors(ajv.errors)}`,
            };
        }
        const validate = ajv.compile(schema);
        compiledSchemas.set(schema, validate);
        return { valid: true, value: validate };
    } catch (error) {
        return {
            valid: false,
            error: `Invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/** Validate a provider-visible tool definition and compile its parameter schema. */
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
    const compiled = compileSchema(schema);
    if (!compiled.valid) {
        return { valid: false, error: `Tool "${fn.name}": ${compiled.error}` };
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

    const compiled = compileSchema(schema);
    if (!compiled.valid) return compiled;
    if (!compiled.value(value)) {
        return {
            valid: false,
            error: `Invalid tool arguments: ${formatErrors(compiled.value.errors)}`,
        };
    }
    return { valid: true, value };
}
