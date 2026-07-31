import type { H3Event } from 'h3';
import { createError } from 'h3';
import type {
    ConnectHostMetadata,
    StoredConnectHost,
} from './types';

const ADJECTIVES = [
    'AMBER', 'BRAVE', 'BRIGHT', 'CALM', 'CLEAR', 'CORAL', 'EMBER', 'GENTLE',
    'GOLDEN', 'GREEN', 'HAPPY', 'IVORY', 'LUNAR', 'MINT', 'NIMBLE', 'NOVA',
    'OCEAN', 'QUIET', 'RAPID', 'ROYAL', 'SILVER', 'SOLAR', 'STILL', 'SUNNY',
    'SWIFT', 'TEAL', 'TIDY', 'VIOLET', 'WARM', 'WILD', 'WISE', 'ZEN',
] as const;
const NOUNS = [
    'BIRD', 'BROOK', 'CEDAR', 'CLOUD', 'COMET', 'DAWN', 'FIELD', 'FOX',
    'GROVE', 'HARBOR', 'HAWK', 'HILL', 'LAKE', 'LEAF', 'MOON', 'NEST',
    'NORTH', 'OAK', 'PINE', 'RIVER', 'ROBIN', 'ROCK', 'SKY', 'STAR',
    'STONE', 'SUMMIT', 'TIDE', 'TRAIL', 'TREE', 'VALE', 'WAVE', 'WREN',
] as const;

export function createUserCode(): string {
    const adjective = ADJECTIVES[cryptoRandomInt(ADJECTIVES.length)]!;
    const firstNoun = NOUNS[cryptoRandomInt(NOUNS.length)]!;
    const secondNoun = NOUNS[cryptoRandomInt(NOUNS.length)]!;
    const number = cryptoRandomInt(1000).toString().padStart(3, '0');
    return `${adjective}-${firstNoun}-${secondNoun}-${number}`;
}

export function normalizeUserCode(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export function parseConnectHost(value: unknown): ConnectHostMetadata {
    if (!isRecord(value)) {
        throw createError({ statusCode: 400, statusMessage: 'Computer details are required.' });
    }
    const host: ConnectHostMetadata = {
        name: text(value.name, 80),
        platform: text(value.platform, 24),
        architecture: text(value.architecture, 24),
        internVersion: text(value.internVersion, 40),
        hostId: optionalText(value.hostId, 200),
        signingPublicKey: optionalText(value.signingPublicKey, 500),
        noisePublicKey: optionalText(value.noisePublicKey, 500),
    };
    if (!host.name || !host.platform || !host.architecture || !host.internVersion) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Computer details are incomplete.',
        });
    }
    return host;
}

export function storeConnectHost(host: ConnectHostMetadata): StoredConnectHost {
    return {
        name: host.name,
        platform: host.platform,
        architecture: host.architecture,
        intern_version: host.internVersion,
        host_id: host.hostId,
        signing_public_key: host.signingPublicKey,
        noise_public_key: host.noisePublicKey,
    };
}

export function noStore(event: H3Event): void {
    event.node.res.setHeader('Cache-Control', 'no-store, private');
    event.node.res.setHeader('Pragma', 'no-cache');
}

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max: number): string | undefined {
    const result = text(value, max);
    return result || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cryptoRandomInt(max: number): number {
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    return array[0]! % max;
}
