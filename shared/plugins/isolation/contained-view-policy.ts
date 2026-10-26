import { isToolCardEmbedOrigin } from '../../../packages/plugin-sdk/src/tool-card-manifest';
import { CONTAINED_VIEW_SCRIPT_HASH } from './contained-view-document';
export const CONTAINED_VIEW_SANDBOX = 'allow-scripts';
export function containedViewCsp(
    embeds: { frames?: readonly string[]; images?: readonly string[] } = {},
    scriptHash = CONTAINED_VIEW_SCRIPT_HASH
): string {
    const origins = [...(embeds.frames ?? []), ...(embeds.images ?? [])];
    if (
        origins.length > 8 ||
        origins.some((origin) => !isToolCardEmbedOrigin(origin)) ||
        !/^sha256-[A-Za-z0-9+/]+=*$/.test(scriptHash)
    )
        throw new Error('Invalid contained-view policy');
    return (
        "default-src 'none'; script-src '" +
        scriptHash +
        "' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:" +
        (embeds.images?.length ? ' ' + embeds.images.join(' ') : '') +
        '; font-src blob: data:; media-src blob: data:; frame-src ' +
        (embeds.frames?.join(' ') || "'none'") +
        "; connect-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts"
    );
}
