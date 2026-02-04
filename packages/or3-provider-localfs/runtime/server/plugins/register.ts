import { registerStorageGatewayAdapter } from '~~/server/storage/gateway/registry';
import { localFsStorageGatewayAdapter } from '../storage/localfs-storage-gateway-adapter';

export default defineNitroPlugin(() => {
    registerStorageGatewayAdapter({
        id: 'localfs',
        create: () => localFsStorageGatewayAdapter,
    });
});
