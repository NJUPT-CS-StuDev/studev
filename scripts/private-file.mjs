// Where this machine keeps studev's private files (credentials, recovery codes, test state).
// Set STUDEV_PRIVATE_DIR to keep them outside the repository; without it they live in the repository root.
import { pathToFileURL } from 'node:url';

const dir = process.env.STUDEV_PRIVATE_DIR;
const base = dir ? pathToFileURL(dir.replace(/[\\/]*$/, '/')) : new URL('../', import.meta.url);

export const privateFile = (name) => new URL(name, base);
