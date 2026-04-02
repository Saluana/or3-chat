import { useRuntimeConfig } from '#imports';

export interface Or3NetServerConfig {
	enabled: boolean;
	hostUrl: string;
	exchangeSecret: string;
	exchangeIssuer: string;
	exchangeAudience: string;
	exchangeTtlMs: number;
}

function normalizeHttpUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';

	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return '';
		}
		url.pathname = url.pathname.replace(/\/$/, '');
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/, '');
	} catch {
		return '';
	}
}

export function getOr3NetServerConfig(): Or3NetServerConfig {
	const runtimeConfig = useRuntimeConfig();
	const config = runtimeConfig.or3Net as Partial<Or3NetServerConfig>;

	const hostUrl = normalizeHttpUrl(config.hostUrl ?? '');
	const exchangeSecret = (config.exchangeSecret ?? '').trim();
	const exchangeIssuer = (config.exchangeIssuer ?? 'or3-chat').trim() || 'or3-chat';
	const exchangeAudience = (config.exchangeAudience ?? 'or3-net').trim() || 'or3-net';
	const exchangeTtlMs =
		typeof config.exchangeTtlMs === 'number' && Number.isFinite(config.exchangeTtlMs) && config.exchangeTtlMs > 0
			? Math.floor(config.exchangeTtlMs)
			: 60_000;

	return {
		enabled: Boolean(hostUrl && exchangeSecret),
		hostUrl,
		exchangeSecret,
		exchangeIssuer,
		exchangeAudience,
		exchangeTtlMs,
	};
}
