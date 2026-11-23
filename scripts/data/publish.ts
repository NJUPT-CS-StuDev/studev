import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import product from '../../product.json' with { type: 'json' };
import { CAMPUS_POINTER_PATH, campusPointer, validRelease } from '../../src/campus/world/release.ts';
import { prepareSite, directoryBytes } from './site.ts';
import { offlineRelease } from '../../src/pwa/release.ts';

const entry = `${product.campusOrigin}/campus-release.json`;
const snapshot = await offlineRelease();
const verifyOnly = process.argv.includes('--verify-only');
if (!validRelease(snapshot)) throw new Error('local campus snapshot is not valid');
const pointerEntry = new URL(CAMPUS_POINTER_PATH, entry);
const encodedPointer = JSON.stringify(campusPointer(snapshot));
const prepareOnly = process.argv.includes('--prepare-only');
if (!verifyOnly && !prepareOnly) {
    const baseline = await fetch(entry, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
    if (baseline.ok) {
        const previous: unknown = await baseline.json();
        if (!validRelease(previous)) throw new Error('the current public release is not readable; publication stopped');
        if (JSON.stringify(previous) === JSON.stringify(snapshot)) {
            const publishedPointer = await fetch(pointerEntry, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
            if (publishedPointer.ok && JSON.stringify(await publishedPointer.json()) === encodedPointer) {
                console.log('campus snapshot is already current');
                process.exit(0);
            }
            if (!publishedPointer.ok && publishedPointer.status !== 404) throw new Error(`reading the current online pointer failed (${publishedPointer.status}); publication stopped`);
        }
    } else if (baseline.status !== 404) {
        throw new Error(`reading the current public release failed (${baseline.status}); publication stopped`);
    }
}
const tempBase = process.env.RUNNER_TEMP || (process.platform === 'win32' ? 'D:/Temp/codex/studev-data-publish' : '/tmp/studev-data-publish');
await mkdir(tempBase, { recursive: true });
const output = await mkdtemp(join(tempBase, 'data-'));
let deploymentId: string | undefined;
if (!verifyOnly) {
await prepareSite(output, snapshot);
console.log(`${product.dataProject.name}: ${await directoryBytes(output)} bytes (complete deployment archive)`);
if (prepareOnly) { console.log(`prepared at ${output}`); process.exit(0); }

const npm = process.env.npm_execpath;
if (!npm) throw new Error('run the publisher with npm run data:publish');
const args = [join(dirname(npm), 'npx-cli.js'), '--yes', 'edgeone@1.6.44', 'makers', 'deploy', output, '-n', product.dataProject.name, '--json'];
const token = process.env.EDGEONE_API_TOKEN || process.env.EDGEONE_PAGES_API_TOKEN;
const stdout: string[] = [], stderr: string[] = [];
const env: NodeJS.ProcessEnv = {};
for (const name of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NPM_CONFIG_CACHE']) if (process.env[name]) env[name] = process.env[name];
env.PAGES_SOURCE = 'skills'; if (token) env.EDGEONE_PAGES_API_TOKEN = token;
const redact = (text: string) => (token ? text.split(token).join('[redacted]') : text).replace(/([?&]eo_token=)[^&\s"']+/g, '$1[redacted]');
const child = spawn(process.execPath, args, { cwd: output, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout!.on('data', chunk => stdout.push(String(chunk))); child.stderr!.on('data', chunk => stderr.push(String(chunk)));
const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('exit', done); });
const log = [...stdout, ...stderr].join('');
// After "Deploy Success" the CLI still asks for a preview token; that call failing (it has, with 522) leaves the
// deployment live. Whether it is live is decided below, by reading the public pointer and its resources.
const deployed = /Deploy Success/.test(log);
if (code !== 0 && !deployed) throw new Error(`data deployment failed (${code})\n${redact(log).slice(-4000)}`);
if (code === 0) {
    const result = JSON.parse(stdout.join('').trim().split(/\r?\n/).at(-1)!) as { status: string; url: string; deploymentId: string };
    if (result.status !== 'success') throw new Error('data deployment did not report success');
    deploymentId = result.deploymentId;
} else {
    deploymentId = log.match(/Deployment ID: (\w+)/)?.[1];
    console.log(`the deployment succeeded but the CLI then failed (${code}); verifying the public entry`);
}
console.log(JSON.stringify({ deploymentId, entry }));
}
const deadline = Date.now() + 180_000;
for (;;) {
try {
const [actualResponse, pointerResponse] = await Promise.all([
    fetch(entry, { cache: 'no-cache', signal: AbortSignal.timeout(30_000) }),
    fetch(pointerEntry, { cache: 'no-cache', signal: AbortSignal.timeout(30_000) }),
]);
const actual = actualResponse.ok ? await actualResponse.json() : null;
const actualPointer = pointerResponse.ok ? await pointerResponse.json() : null;
if (!validRelease(actual) || JSON.stringify(campusPointer(actual)) !== encodedPointer || JSON.stringify(actualPointer) !== encodedPointer) {
    throw new Error('the public release and online pointer do not name the same published component set');
}
for (const path of [`${snapshot.map_base}/仙林/entities.json`, `${snapshot.knowledge_base}/knowledge.json`, `${snapshot.search_base}/manifest.json`, `${snapshot.base}/rooms/index.json`, `${snapshot.base}/entities/course-search/manifest.json`]) {
    const response = await fetch(new URL(path, entry), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`published resource not readable (${response.status}): ${path}`);
    await response.body?.cancel();
}
break;
} catch (error) {
    if (Date.now() >= deadline) throw error;
    console.log('waiting for the data entry and resources to become readable');
    await new Promise(done => setTimeout(done, 3000));
}
}
await writeFile(join(output, 'published.json'), JSON.stringify({ entry, version: snapshot.version, deploymentId }));
console.log(`campus current: ${entry} (${snapshot.version})`);
console.log(`publication receipt: ${join(output, 'published.json')}`);
