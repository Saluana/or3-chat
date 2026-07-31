import 'dotenv/config';
import { buildOr3CloudConfigFromEnv } from './server/admin/config/resolve-config';

export const or3CloudConfig = buildOr3CloudConfigFromEnv(process.env);
