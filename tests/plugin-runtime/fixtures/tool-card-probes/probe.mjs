// Each operation executes inside the publisher module in the exact card frame.
export default {
    mount(el, card) {
        const args = card.args;
        const timeout = (promise) =>
            Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 1200)
                )
            ]);
        const target =
            args.target +
            '/?probe=' +
            encodeURIComponent(args.channel) +
            '&context=' +
            args.context;
        const output = document.createElement('output');
        output.dataset.probeResult = '';
        el.append(output);
        const attempt = async () => {
            switch (args.channel) {
                case 'parent.access':
                    return parent.document.body.tagName;
                case 'top.access':
                    return top.document.body.tagName;
                case 'storage.local':
                    localStorage.setItem('or3-card-probe', '1');
                    return localStorage.getItem('or3-card-probe');
                case 'storage.session':
                    sessionStorage.setItem('or3-card-probe', '1');
                    return sessionStorage.getItem('or3-card-probe');
                case 'storage.cookie':
                    document.cookie = 'or3_card_probe=1';
                    if (!document.cookie.includes('or3_card_probe'))
                        throw Error('blocked');
                    return true;
                case 'storage.indexedDB':
                    return timeout(
                        new Promise((resolve, reject) => {
                            const r = indexedDB.open('or3-card-probe');
                            r.onsuccess = () => {
                                r.result.close();
                                resolve(true);
                            };
                            r.onerror = () => reject(r.error);
                        })
                    );
                case 'network.fetch':
                    return timeout(fetch(target, { mode: 'no-cors' }));
                case 'network.xhr':
                    return timeout(
                        new Promise((resolve, reject) => {
                            const r = new XMLHttpRequest();
                            r.open('GET', target);
                            r.onload = () => resolve(true);
                            r.onerror = () => reject(Error('blocked'));
                            r.send();
                        })
                    );
                case 'network.websocket':
                    return timeout(
                        new Promise((resolve, reject) => {
                            const r = new WebSocket(target.replace('http:', 'ws:'));
                            r.onopen = () => {
                                r.close();
                                resolve(true);
                            };
                            r.onerror = () => reject(Error('blocked'));
                        })
                    );
                case 'network.eventsource':
                    return timeout(
                        new Promise((resolve, reject) => {
                            const r = new EventSource(target);
                            r.onmessage = () => {
                                r.close();
                                resolve(true);
                            };
                            r.onerror = () => {
                                r.close();
                                reject(Error('blocked'));
                            };
                        })
                    );
                case 'network.beacon':
                    if (!navigator.sendBeacon(target, 'probe')) throw Error('blocked');
                    return true;
                case 'network.webrtc': {
                    const pc = new RTCPeerConnection({
                        iceServers: [{ urls: args.stun }]
                    });
                    pc.createDataChannel('probe');
                    await pc.setLocalDescription(await pc.createOffer());
                    await new Promise((resolve) => setTimeout(resolve, 700));
                    pc.close();
                    return true;
                }
                case 'workers.nested': {
                    const url = URL.createObjectURL(
                        new Blob(['postMessage(1)'], {
                            type: 'text/javascript'
                        })
                    );
                    try {
                        return await timeout(
                            new Promise((resolve, reject) => {
                                const w = new Worker(url);
                                w.onmessage = () => {
                                    w.terminate();
                                    resolve(true);
                                };
                                w.onerror = () => reject(Error('blocked'));
                            })
                        );
                    } finally {
                        URL.revokeObjectURL(url);
                    }
                }
                case 'imports.remote':
                    return timeout(import(target));
                case 'embed.image':
                    return timeout(
                        new Promise((resolve, reject) => {
                            const image = new Image();
                            image.onload = () => resolve(true);
                            image.onerror = () => reject(Error('blocked'));
                            image.src = target;
                            el.append(image);
                        })
                    );
                case 'embed.frame': {
                    const frame = document.createElement('iframe');
                    frame.src = target;
                    el.append(frame);
                    return new Promise((resolve) =>
                        setTimeout(() => resolve(true), 500)
                    );
                }
                case 'realm.about-blank': {
                    const frame = document.createElement('iframe');
                    frame.src = 'about:blank';
                    el.append(frame);
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    const RTC = frame.contentWindow.RTCPeerConnection;
                    const pc = new RTC({ iceServers: [{ urls: args.stun }] });
                    pc.createDataChannel('probe');
                    await pc.setLocalDescription(await pc.createOffer());
                    await new Promise((resolve) => setTimeout(resolve, 700));
                    pc.close();
                    return true;
                }
                case 'navigation.location':
                    location.href = target;
                    return true;
                case 'navigation.anchor': {
                    const a = document.createElement('a');
                    a.href = target;
                    el.append(a);
                    a.click();
                    return true;
                }
                case 'navigation.meta': {
                    const meta = document.createElement('meta');
                    meta.httpEquiv = 'refresh';
                    meta.content = '0;url=' + target;
                    document.head.append(meta);
                    return true;
                }
                case 'navigation.document-open':
                    document.open();
                    document.write(
                        '<meta http-equiv="refresh" content="0;url=' + target + '">'
                    );
                    document.close();
                    return true;
                case 'forms.submit': {
                    const form = document.createElement('form');
                    form.action = target;
                    form.method = 'POST';
                    el.append(form);
                    form.submit();
                    return true;
                }
                case 'popups.open': {
                    const popup = window.open(target, '_blank');
                    if (!popup) throw Error('blocked');
                    return true;
                }
                case 'hints.prefetch':
                case 'hints.preload':
                case 'hints.dns': {
                    const link = document.createElement('link');
                    link.rel =
                        args.channel === 'hints.dns'
                            ? 'dns-prefetch'
                            : args.channel === 'hints.preload'
                              ? 'preload'
                              : 'prefetch';
                    link.as = 'script';
                    link.href = target;
                    document.head.append(link);
                    return true;
                }
                case 'protocol.flood':
                    return Promise.all(
                        Array.from({ length: 30 }, () => card.setState({ probe: true }))
                    );
                case 'activation.send':
                case 'activation.openLink':
                    Object.defineProperty(navigator, 'userActivation', {
                        value: { isActive: true }
                    });
                    return args.channel === 'activation.send'
                        ? card.send('forged')
                        : card.openLink(target);
                default:
                    throw Error('unknown probe');
            }
        };
        const button = document.createElement('button');
        button.textContent = 'Run probe';
        button.onclick = () => {
            void attempt().then(
                (result) => {
                    output.textContent = JSON.stringify({
                        attempted: true,
                        resolved: true,
                        action: result?.ok,
                        code: result?.error?.code
                    });
                },
                (error) => {
                    output.textContent = JSON.stringify({
                        attempted: true,
                        resolved: false,
                        error: error.name
                    });
                }
            );
        };
        el.append(button);
        if (args.channel.startsWith('activation.'))
            setTimeout(() => button.onclick(), 7500);
        return () => {};
    }
};
