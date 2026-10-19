import type { Plugin } from 'vite';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const grammarJson = /JSON\.parse\(("(?:[^"\\]|\\.)*")\)/;

function readGrammar(source: string): Json | undefined {
    const match = source.match(grammarJson);
    if (!match) return undefined;
    try { return JSON.parse(JSON.parse(match[1]!) as string) as Json; }
    catch { return undefined; }
}

function visitStrings(value: Json, visit: (value: string) => void): void {
    if (typeof value === 'string') visit(value);
    else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (!Array.isArray(value)) visit(key);
            visitStrings(child, visit);
        }
    }
}

/** Compact generated data without changing tokens, grammar objects or lazy imports. */
export function compactGeneratedDataPlugin(): Plugin {
    let debug = false;

    return {
        name: 'or3:compact-generated-data',
        apply: 'build',
        enforce: 'pre',
        applyToEnvironment: (environment) => environment.config.consumer === 'client',
        configResolved(config) { debug = Boolean(config.build.sourcemap); },
        transform(source, id) {
            // Keep original source maps in debug builds and leave other packages
            // untouched. Changed upstream data formats safely use their originals.
            if (debug) return null;
            const path = id.replaceAll('\\', '/');
            if (/\/node_modules\/@shikijs\/langs\/dist\/[^/]+\.mjs$/.test(path)) {
                if (/\b__or3_s\d+\b/.test(source)) return null;
                const grammar = readGrammar(source);
                if (grammar === undefined) return null;
                const counts = new Map<string, number>();
                visitStrings(grammar, (value) => {
                    counts.set(value, (counts.get(value) ?? 0) + 1);
                });
                const pool = new Map([...counts]
                    .filter(([value, count]) => value.length > 4 && count > 1)
                    .map(([value], index) => [value, `__or3_s${index}`]));
                function serialize(value: Json): string {
                    if (typeof value === 'string') {
                        const name = pool.get(value);
                        if (name) return name;
                    }
                    if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
                    if (value && typeof value === 'object') return `{${Object.entries(value)
                        .map(([key, child]) => `${pool.has(key) ? `[${pool.get(key)}]` : key === '__proto__' ? '["__proto__"]' : JSON.stringify(key)}:${serialize(child)}`)
                        .join(',')}}`;
                    // JSON can contain -0 or overflow a number to Infinity.
                    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
                    return JSON.stringify(value);
                }
                const expression = serialize(grammar);
                // Keep the immutable string table inside its language module.
                // Destructuring a frozen table prevents compression from
                // inlining repeated strings back into every pattern. Grammar
                // objects/arrays remain independent; lazy boundaries stay intact.
                const declarations = pool.size
                    ? `const [${[...pool.values()].join(',')}]=Object.freeze(${JSON.stringify([...pool.keys()])});\n`
                    : '';
                return { code: declarations + source.replace(grammarJson, () => `(${expression})`), map: null };
            }
            if (/\/node_modules\/gpt-tokenizer\/esm\/bpeRanks\/[^/]+\.js$/.test(path)) {
                const code = source.replace(/const (c\d+) = (\[[^\n]+\]);/g, (original: string, name: string, json: string) => {
                    let tokens: Json;
                    try { tokens = JSON.parse(json) as Json; }
                    catch { return original; }
                    if (!Array.isArray(tokens) || tokens.length < 1000) return original;
                    const replacements: [number, Json][] = [];
                    // DEL is one UTF-8 byte. Preserve tokens containing it and
                    // partial UTF-8 byte arrays explicitly at their original rank.
                    const packed = tokens.map((token, index) => {
                        if (typeof token === 'string' && !token.includes('\x7f')) return token;
                        replacements.push([index, token]);
                        return '';
                    }).join('\x7f');
                    return `const ${name}=${JSON.stringify(packed)}.split("\\x7f");for(const [i,t] of ${JSON.stringify(replacements)})${name}[i]=t;`;
                });
                return code === source ? null : { code: code.replace(/\/\/# sourceMappingURL=.*$/m, ''), map: null };
            }
            return null;
        },
    };
}
