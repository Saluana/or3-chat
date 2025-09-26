self.addEventListener('fetch', (event) => {
    try {
        const url = new URL(event.request.url);
        if (url.origin === self.location.origin && url.pathname.startsWith('/streamsaver/')) {
            // Let the dedicated StreamSaver worker handle these requests
            console.info('[workspace-backup][main-sw] bypassing StreamSaver fetch', {
                url: event.request.url,
            });
            event.stopImmediatePropagation?.();
            return;
        }
    } catch (error) {
        // Ignore URL parsing issues; let other handlers manage the request
    }
});
