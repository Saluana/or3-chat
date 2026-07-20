import { describe, expect, it } from 'vitest';
import { ThemeActivationCoordinator } from '../activation-transaction';

describe('ThemeActivationCoordinator', () => {
    it('allows only the latest rapid activation to commit', async () => {
        const coordinator = new ThemeActivationCoordinator();
        const committed: string[] = [];
        let releaseA!: () => void;
        const prepareA = new Promise<void>((resolve) => { releaseA = resolve; });

        const activate = async (name: string, preparation: Promise<void>) => {
            const transaction = coordinator.begin();
            await preparation;
            if (transaction.isCurrent()) committed.push(name);
        };

        const pendingA = activate('a', prepareA);
        await activate('b', Promise.resolve());
        releaseA();
        await pendingA;

        expect(committed).toEqual(['b']);
    });
});
