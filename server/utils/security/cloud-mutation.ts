import { CLOUD_MUTATION_INTENT } from '~~/shared/sync/types';
import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { requireSameOriginMutation } from './mutation-guard';

/** Browser writes need a preflighted intent and a trusted origin before body parsing. */
export function requireCloudMutation(event: H3Event): void {
    requireSameOriginMutation(event, {
        intentHeader: 'x-or3-cloud-intent',
        intentValue: getRequestHeader(event, 'x-or3-cloud-intent') === CLOUD_MUTATION_INTENT
            ? CLOUD_MUTATION_INTENT : 'mutation',
        requireJson: true,
        allowConfiguredOrigins: true,
        allowOriginlessBearer: true,
    });
}
