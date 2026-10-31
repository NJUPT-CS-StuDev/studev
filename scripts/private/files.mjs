// Where this machine keeps studev's private files (credentials, recovery codes, test state).
// STUDEV_PRIVATE_DIR must point to external private storage.
import { pathToFileURL } from 'node:url';

const dir = process.env.STUDEV_PRIVATE_DIR;
if (!dir) throw new Error('Set STUDEV_PRIVATE_DIR to private storage outside the repository.');
const base = pathToFileURL(dir.replace(/[\\/]*$/, '/'));

export const privateFile = (name) => new URL(name, base);
