// The Windows installer, its version the product's own (product.json), its icons drawn from the brand's one logo.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const product = JSON.parse(readFileSync(new URL('../product.json', import.meta.url), 'utf8'));
const version = product.android.versionName;
mkdirSync(new URL('src-tauri/gen/', here), { recursive: true });
writeFileSync(new URL('src-tauri/gen/version.json', here), JSON.stringify({ version }));
const tauri = (args) => execSync(`npx tauri ${args}`, { stdio: 'inherit', cwd: here });
tauri('icon ../public/assets/logo.png');
tauri('build --config src-tauri/gen/version.json');
console.log(`StuDev ${version} for Windows built`);
