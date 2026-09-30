import { describePackage } from './lib/format.mjs';

export default function register() {
    return { id: 'or3.golden-portable', describe: describePackage };
}
