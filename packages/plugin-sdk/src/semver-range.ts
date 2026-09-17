/**
 * First-party semver range evaluation for the V2 conformance engine.
 *
 * The standalone `or3-plugin` CLI ships no third-party runtime code, so the
 * reviewer and the SDK share this small evaluator instead of depending on the
 * `semver` package. It covers the range grammar OR3 packages use: exact and
 * partial versions, `^`, `~`, `>`, `>=`, `<`, `<=`, `=`, `*`/`x` wildcards,
 * whitespace-separated AND sets, `||` OR sets, and hyphen ranges.
 */

export interface ParsedVersion {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: readonly (string | number)[];
}

export type ComparatorOperator = '>' | '>=' | '<' | '<=' | '=';

export interface Comparator {
    readonly operator: ComparatorOperator;
    readonly version: ParsedVersion;
}

export type ComparatorSet = readonly Comparator[];

interface PartialVersion {
    readonly major: number | null;
    readonly minor: number | null;
    readonly patch: number | null;
    readonly prerelease: readonly (string | number)[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_PATTERN =
    /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function prereleaseParts(raw: string): Array<string | number> {
    return raw.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function parseVersion(input: string): ParsedVersion | null {
    const match = VERSION_PATTERN.exec(input.trim());
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? prereleaseParts(match[4]) : [],
    };
}

function parsePartial(token: string): PartialVersion | null {
    const match = PARTIAL_PATTERN.exec(token.trim());
    if (!match) return null;
    const part = (value: string | undefined): number | null => {
        if (value === undefined || value === '' || value === 'x' || value === 'X' || value === '*') {
            return null;
        }
        return Number(value);
    };
    const major = part(match[1]);
    const minor = match[2] === undefined ? null : part(match[2]);
    const patch = match[3] === undefined ? null : part(match[3]);
    if (major === null && (match[2] !== undefined || match[3] !== undefined)) return null;
    return {
        major,
        minor,
        patch,
        prerelease: match[4] ? prereleaseParts(match[4]) : [],
    };
}

function version(
    major: number,
    minor: number,
    patch: number,
    prerelease: readonly (string | number)[] = []
): ParsedVersion {
    return { major, minor, patch, prerelease };
}

function expandComparator(operator: ComparatorOperator, partial: PartialVersion): ComparatorSet | null {
    const major = partial.major;
    if (major === null) {
        // A wildcard major matches any release version.
        return operator === '<' ? [{ operator: '<', version: version(0, 0, 0) }] : [];
    }
    const minor = partial.minor;
    const patch = partial.patch;
    const minorWild = minor === null;
    const patchWild = patch === null;
    const lower = (): ParsedVersion =>
        version(major, minor ?? 0, patch ?? 0, partial.prerelease);
    if (operator === '=') {
        if (minorWild && patchWild) {
            return [
                { operator: '>=', version: version(major, 0, 0) },
                { operator: '<', version: version(major + 1, 0, 0) },
            ];
        }
        if (patchWild) {
            return [
                { operator: '>=', version: version(major, minor!, 0) },
                { operator: '<', version: version(major, minor! + 1, 0) },
            ];
        }
        return [{ operator: '=', version: lower() }];
    }
    if (operator === '>=' || operator === '<') {
        return [{ operator, version: lower() }];
    }
    if (operator === '>') {
        if (minorWild && patchWild) return [{ operator: '>=', version: version(major + 1, 0, 0) }];
        if (patchWild) return [{ operator: '>=', version: version(major, minor! + 1, 0) }];
        return [{ operator: '>', version: lower() }];
    }
    // operator === '<='
    if (minorWild && patchWild) return [{ operator: '<', version: version(major + 1, 0, 0) }];
    if (patchWild) return [{ operator: '<', version: version(major, minor! + 1, 0) }];
    return [{ operator: '<=', version: lower() }];
}

function expandCaret(partial: PartialVersion): ComparatorSet | null {
    const major = partial.major;
    if (major === null) return [];
    const minor = partial.minor;
    const patch = partial.patch;
    const minorWild = minor === null;
    const patchWild = patch === null;
    const lower = version(major, minor ?? 0, patch ?? 0, partial.prerelease);
    let upper: ParsedVersion;
    if (major > 0) upper = version(major + 1, 0, 0);
    else if (minorWild) upper = version(1, 0, 0);
    else if ((minor ?? 0) > 0) upper = version(0, (minor ?? 0) + 1, 0);
    else if (patchWild) upper = version(0, (minor ?? 0) + 1, 0);
    else upper = version(0, 0, (patch ?? 0) + 1);
    return [
        { operator: '>=', version: lower },
        { operator: '<', version: upper },
    ];
}

function expandTilde(partial: PartialVersion): ComparatorSet | null {
    const major = partial.major;
    if (major === null) return [];
    const minor = partial.minor;
    const lower = version(major, minor ?? 0, partial.patch ?? 0, partial.prerelease);
    const upper =
        minor === null ? version(major + 1, 0, 0) : version(major, minor + 1, 0);
    return [
        { operator: '>=', version: lower },
        { operator: '<', version: upper },
    ];
}

function expandToken(token: string): ComparatorSet | null {
    const match = /^(>=|<=|>|<|\^|~|=)?\s*(.+)$/.exec(token);
    if (!match) return null;
    const operator = match[1];
    const partial = parsePartial(match[2]!);
    if (!partial) return null;
    switch (operator) {
        case '^':
            return expandCaret(partial);
        case '~':
            return expandTilde(partial);
        case undefined:
        case '=':
            return expandComparator('=', partial);
        default:
            return expandComparator(operator as ComparatorOperator, partial);
    }
}

function expandHyphen(lowerToken: string, upperToken: string): ComparatorSet | null {
    const lowerPartial = parsePartial(lowerToken);
    const upperPartial = parsePartial(upperToken);
    if (!lowerPartial || !upperPartial || lowerPartial.major === null || upperPartial.major === null) {
        return null;
    }
    const lower = expandComparator('>=', lowerPartial);
    if (!lower) return null;
    let upper: ComparatorSet;
    if (upperPartial.minor === null) {
        upper = [{ operator: '<', version: version(upperPartial.major + 1, 0, 0) }];
    } else if (upperPartial.patch === null) {
        upper = [{ operator: '<', version: version(upperPartial.major, upperPartial.minor + 1, 0) }];
    } else {
        upper = [
            {
                operator: '<=',
                version: version(
                    upperPartial.major,
                    upperPartial.minor,
                    upperPartial.patch,
                    upperPartial.prerelease
                ),
            },
        ];
    }
    return [...lower, ...upper];
}

function parseRange(range: string): ComparatorSet[] | null {
    const trimmed = range.trim();
    if (trimmed === '') return [[]];
    const sets: ComparatorSet[] = [];
    for (const rawPart of trimmed.split('||')) {
        const part = rawPart.trim();
        if (part === '') continue;
        const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(part);
        if (hyphen) {
            const set = expandHyphen(hyphen[1]!, hyphen[2]!);
            if (!set) return null;
            sets.push(set);
            continue;
        }
        const comparators: Comparator[] = [];
        // An operator may be separated from its version by whitespace
        // (`>= 2.0.0 < 3.0.0`, `^ 2.0.0`), so re-join those tokens before parsing.
        const rawTokens = part.split(/\s+/).filter((token) => token.length > 0);
        const tokens: string[] = [];
        for (let index = 0; index < rawTokens.length; index += 1) {
            const token = rawTokens[index]!;
            if (/^(>=|<=|>|<|\^|~|=)$/.test(token)) {
                const nextToken = rawTokens[index + 1];
                if (nextToken === undefined) return null;
                tokens.push(`${token}${nextToken}`);
                index += 1;
                continue;
            }
            tokens.push(token);
        }
        for (const token of tokens) {
            const expanded = expandToken(token);
            if (!expanded) return null;
            comparators.push(...expanded);
        }
        sets.push(comparators);
    }
    return sets.length > 0 ? sets : null;
}

function compareIdentifiers(left: string | number, right: string | number): number {
    const leftNumeric = typeof left === 'number';
    const rightNumeric = typeof right === 'number';
    if (leftNumeric && rightNumeric) return left < right ? -1 : left > right ? 1 : 0;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
}

export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
    if (left.major !== right.major) return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
    if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
    if (left.prerelease.length === 0) return 1;
    if (right.prerelease.length === 0) return -1;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const a = left.prerelease[index];
        const b = right.prerelease[index];
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        const order = compareIdentifiers(a, b);
        if (order !== 0) return order;
    }
    return 0;
}

function matchComparator(candidate: ParsedVersion, comparator: Comparator): boolean {
    const order = compareVersions(candidate, comparator.version);
    switch (comparator.operator) {
        case '>':
            return order > 0;
        case '>=':
            return order >= 0;
        case '<':
            return order < 0;
        case '<=':
            return order <= 0;
        case '=':
            return order === 0;
    }
}

function satisfiesSet(candidate: ParsedVersion, set: ComparatorSet): boolean {
    for (const comparator of set) {
        if (!matchComparator(candidate, comparator)) return false;
    }
    if (candidate.prerelease.length > 0) {
        return set.some(
            (comparator) =>
                comparator.version.prerelease.length > 0 &&
                comparator.version.major === candidate.major &&
                comparator.version.minor === candidate.minor &&
                comparator.version.patch === candidate.patch
        );
    }
    return true;
}

/** True when `range` is a syntactically valid semver range. */
export function isValidVersionRange(range: unknown): boolean {
    return typeof range === 'string' && parseRange(range) !== null;
}

/** True when `version` satisfies `range` (standard semver semantics). */
export function satisfiesVersionRange(version: string, range: string): boolean {
    const candidate = parseVersion(version);
    if (!candidate) return false;
    const sets = parseRange(range);
    if (!sets) return false;
    return sets.some((set) => satisfiesSet(candidate, set));
}
