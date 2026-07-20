import { describe, expect, it } from 'vitest';
import { createContributionSurfaceSelection } from '../contribution-surface-selection';
import { normalizePluginContributionSurfaces } from '~~/shared/plugins/contribution-surfaces';
import { PLUGIN_CONTRIBUTION_SURFACES } from '~~/shared/plugins/contribution-surfaces';

describe('contribution surface startup selection', () => {
    it('selects and reverts one surface independently', () => {
        const messageOnly = createContributionSurfaceSelection(['message-actions']);
        expect(messageOnly.isSelected('message-actions')).toBe(true);
        expect(messageOnly.isSelected('header-actions')).toBe(false);

        const reverted = createContributionSurfaceSelection([]);
        expect(reverted.isSelected('message-actions')).toBe(false);
    });

    it('drills one-surface-at-a-time selection and rollback for every surface', () => {
        for (const surface of PLUGIN_CONTRIBUTION_SURFACES) {
            const selected = createContributionSurfaceSelection([surface]);
            expect(selected.listSelected()).toEqual([surface]);
            for (const candidate of PLUGIN_CONTRIBUTION_SURFACES) {
                expect(selected.isSelected(candidate)).toBe(candidate === surface);
            }

            const reverted = createContributionSurfaceSelection([]);
            expect(reverted.isSelected(surface)).toBe(false);
            expect(reverted.listSelected()).toEqual([]);
        }
    });

    it('snapshots the allowlist and ignores later mutation', () => {
        const configured = ['message-actions'];
        const selection = createContributionSurfaceSelection(configured);
        configured.splice(0, 1, 'header-actions');

        expect(selection.listSelected()).toEqual(['message-actions']);
        expect(selection.isSelected('message-actions')).toBe(true);
        expect(selection.isSelected('header-actions')).toBe(false);
    });

    it('deduplicates valid IDs and drops unknown surfaces', () => {
        expect(
            normalizePluginContributionSurfaces([
                'pane-apps',
                'unknown-surface',
                ' pane-apps ',
                'message-actions',
            ])
        ).toEqual(['message-actions', 'pane-apps']);
    });
});
