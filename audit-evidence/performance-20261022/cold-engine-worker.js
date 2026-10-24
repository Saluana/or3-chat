import { measureEngine } from './cold-engine-fixture';
self.onmessage = async () => {
    try { self.postMessage({ result: await measureEngine('js') }); }
    catch (error) { self.postMessage({ error: String(error) }); }
};
