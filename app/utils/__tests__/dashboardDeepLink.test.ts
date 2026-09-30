import { describe, expect, it } from 'vitest';
import {
    dashboardDeepLinkPageId,
    parseDashboardDeepLink,
} from '../dashboardDeepLink';

/**
 * The marketplace copies a request link; the shell must be able to resolve it
 * into a dashboard app plus page without the link naming an app the host does
 * not have.
 */
describe('dashboard deep links', () => {
    it('parses the marketplace request link', () => {
        expect(
            parseDashboardDeepLink({ dashboard: 'marketplace', plugin: 'sample.plugin' })
        ).toEqual({ pluginId: 'marketplace', pageId: null });
    });

    it('parses an explicit page and rejects malformed links', () => {
        expect(
            parseDashboardDeepLink({ dashboard: 'marketplace', page: 'updates' })
        ).toEqual({ pluginId: 'marketplace', pageId: 'updates' });
        expect(parseDashboardDeepLink({})).toBeNull();
        expect(parseDashboardDeepLink({ dashboard: '' })).toBeNull();
        expect(parseDashboardDeepLink({ dashboard: '../etc/passwd' })).toBeNull();
        expect(parseDashboardDeepLink({ dashboard: 'marketplace', page: ' ' })).toEqual({
            pluginId: 'marketplace',
            pageId: null,
        });
    });

    it('defaults to the first registered page', () => {
        expect(
            dashboardDeepLinkPageId(
                { pluginId: 'marketplace', pageId: null },
                ['discover', 'installed', 'updates']
            )
        ).toBe('discover');
        expect(
            dashboardDeepLinkPageId(
                { pluginId: 'marketplace', pageId: 'updates' },
                ['discover', 'installed', 'updates']
            )
        ).toBe('updates');
        // A link to an app with no pages cannot be opened.
        expect(
            dashboardDeepLinkPageId({ pluginId: 'marketplace', pageId: null }, [])
        ).toBeNull();
    });
});
