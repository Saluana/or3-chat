import { useIcon } from '#imports';

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    const legal = runtimeConfig.public?.legal ?? {};

    const actions: Array<{ id: string }> = [];

    const openUrl = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    if (legal.termsUrl) {
        const id = 'legal:terms';
        registerSidebarFooterAction({
            id,
            icon: useIcon('ui.book').value,
            label: 'Terms',
            tooltip: 'Terms of Service',
            order: 900,
            handler: () => openUrl(legal.termsUrl as string),
        });
        actions.push({ id });
    }

    if (legal.privacyUrl) {
        const id = 'legal:privacy';
        registerSidebarFooterAction({
            id,
            icon: useIcon('ui.shield').value,
            label: 'Privacy',
            tooltip: 'Privacy Policy',
            order: 910,
            handler: () => openUrl(legal.privacyUrl as string),
        });
        actions.push({ id });
    }

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            actions.forEach((action) => {
                unregisterSidebarFooterAction?.(action.id);
            });
        });
    }
});
