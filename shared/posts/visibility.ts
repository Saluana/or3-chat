/** Durable namespace: installed plugins may be disabled while their data remains private.
 * This is visibility/ordinary-editor policy, not an authorization or anti-tamper boundary.
 */
export const PRIVATE_PLUGIN_POST_PREFIX = 'or3:plugin-private:';
export const INTERNAL_POST_TYPES = new Set(['or3:document-revision', 'or3:document-revision-chunk']);
export function isInternalPostType(postType: string): boolean {
    return INTERNAL_POST_TYPES.has(postType) || postType.startsWith(PRIVATE_PLUGIN_POST_PREFIX);
}
