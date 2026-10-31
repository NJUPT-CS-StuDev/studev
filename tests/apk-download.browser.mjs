/** Run after npm run build. All downloads and fixtures stay in the task temp directory.
 * npm run test:apk:browser -- --apk <an APK below 24 MiB> */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer';
import { packageApk } from '../scripts/apk/package.mjs';

const { values } = parseArgs({ options: { apk: { type: 'string' }, output: { type: 'string', default: 'D:/Temp/codex/converge/browser' } } });
const root = resolve(values.output);
await mkdir(root, { recursive: true });
const apk = values.apk ? resolve(values.apk) : join(root, 'fixture.apk');
if (!values.apk) await writeFile(apk, randomBytes(6 * 1024 * 1024 + 13));
const source = await readFile(apk);
assert(source.length <= 24 * 1024 * 1024, 'use an APK below 24 MiB for the N=1 case');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const version = JSON.parse(await readFile('src/data/campus-release.json', 'utf8')).version;
const dist = resolve('dist');
let files;
let corrupt = false;
const requests = [];
const server = createServer(async (req, res) => {
    try {
        const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (path === '/pwa-release.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version, core: [], all: [] })); return; }
        const file = path.startsWith('/download/') && !path.endsWith('/')
            ? resolve(files, '.' + path) : resolve(dist, '.' + path, path.endsWith('/') ? 'index.html' : '');
        const base = path.startsWith('/download/') && !path.endsWith('/') ? files : dist;
        if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
        let bytes = await readFile(file);
        const isPart = /\/part-\d+$/.test(path);
        if (isPart) {
            requests.push(path);
            if (corrupt && path.endsWith('part-001')) { bytes = Buffer.from(bytes); bytes[bytes.length - 1] ^= 0xff; }
        }
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Content-Length', bytes.length);
        res.setHeader('Cache-Control', 'no-store');
        // Make intermediate browser download progress observable, even for N=1.
        if (isPart) {
            for (let offset = 0; offset < bytes.length && !res.destroyed; offset += 65536) {
                res.write(bytes.subarray(offset, offset + 65536));
                await new Promise(resolve => setTimeout(resolve, 4));
            }
            res.end();
        } else res.end(bytes);
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, userDataDir: join(root, `profile-${Date.now()}`) });
const cdp = await browser.target().createCDPSession();
const evidence = [];
try {
    for (const count of [1, 3]) {
        const context = await browser.createBrowserContext();
        files = join(root, `n${count}`);
        const output = join(files, 'download');
        const manifest = await packageApk({ apkPath: apk, outputRoot: output, versionName: `9.0.${count}`, versionCode: 90 + count, partBytes: Math.ceil(source.length / count) });
        assert.equal(manifest.parts.length, count);
        const page = await context.newPage();
        await page.setViewport({ width: 1120, height: 900 });
        const contextId = context.id;
        const downloadDir = join(files, 'received'); await mkdir(downloadDir, { recursive: true });
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true, browserContextId: contextId });
        const events = [];
        let guid;
        let begin;
        const began = value => { if (value.url.startsWith(origin)) { guid = value.guid; begin = value; } };
        let complete;
        const finished = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('browser download timed out')), 60_000);
            complete = value => {
                if (value.guid !== guid) return;
                events.push(value);
                if (value.state === 'completed' || value.state === 'canceled') { clearTimeout(timer); resolve(value); }
            };
        });
        cdp.on('Browser.downloadWillBegin', began); cdp.on('Browser.downloadProgress', complete);
        await page.goto(`${origin}/download/`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-download-apk]:not([aria-disabled])', { timeout: 60_000 });
        assert.equal(await page.$eval('[data-download-apk]', el => el.getAttribute('href')), `/download/${manifest.versionCode}/studev-${manifest.versionName}.apk`);
        const headers = await page.evaluate(async path => {
            const response = await fetch(path); const values = Object.fromEntries(response.headers); await response.body.cancel(); return values;
        }, `/download/${manifest.versionCode}/studev-${manifest.versionName}.apk`);
        assert.equal(headers['content-length'], String(source.length));
        assert.equal(headers['content-disposition'], `attachment; filename="studev-${manifest.versionName}.apk"`);
        await page.click('[data-download-apk]');
        // Capture the live secondary hint; CDP below proves native download progress.
        await page.waitForFunction(() => {
            const p = document.querySelector('progress'); return p.value / p.max >= .2;
        });
        const colors = await page.$eval('[data-download-apk]', el => {
            const style = getComputedStyle(el); return { foreground: style.color, background: style.backgroundColor };
        });
        assert.notEqual(colors.foreground, colors.background, 'download label must remain visible while hovered');
        await page.screenshot({ path: join(files, 'downloading.png'), fullPage: true });
        const result = await finished;
        assert.equal(result.state, 'completed'); assert.equal(result.totalBytes, source.length);
        assert.equal(begin.suggestedFilename, `studev-${manifest.versionName}.apk`);
        assert(events.some(e => e.state === 'inProgress' && e.receivedBytes > 0 && e.receivedBytes < source.length), 'native UI must receive intermediate progress for every N');
        const actual = await readFile(join(downloadDir, guid));
        assert.equal(actual.length, source.length); assert.equal(hash(actual), hash(source));
        await page.screenshot({ path: join(files, 'complete.png'), fullPage: true });
        evidence.push({ count, bytes: actual.length, sha256: hash(actual), headers, browserProgress: events, filename: begin.suggestedFilename });
        cdp.off('Browser.downloadWillBegin', began); cdp.off('Browser.downloadProgress', complete);
        await context.close();
    }
    // Same actual worker and browser path: corrupted last byte must fail the
    // download, with no request for the following part.
    corrupt = true; requests.length = 0;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failedDownloadDir = join(root, 'rejected'); await mkdir(failedDownloadDir, { recursive: true });
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: failedDownloadDir, eventsEnabled: true, browserContextId: context.id });
    await page.goto(`${origin}/download/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-download-apk]:not([aria-disabled])', { timeout: 60_000 });
    let failedGuid;
    const began = event => { if (event.url.startsWith(origin)) failedGuid = event.guid; };
    cdp.on('Browser.downloadWillBegin', began);
    let finished;
    const rejected = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('corrupted browser download timed out')), 60_000);
        finished = event => {
            if (event.guid !== failedGuid || event.state === 'inProgress') return;
            clearTimeout(timer); resolve(event);
        };
        cdp.on('Browser.downloadProgress', finished);
    });
    await page.click('[data-download-apk]');
    const failed = await rejected;
    assert.equal(failed.state, 'canceled'); assert(!requests.some(path => path.endsWith('part-002')));
    evidence.push({ corruptionRejected: true, browserFailure: failed, requests: [...requests] });
    cdp.off('Browser.downloadWillBegin', began); cdp.off('Browser.downloadProgress', finished);
    await context.close();
    for (const agent of ['MicroMessenger/8.0', 'QQ/9.0']) {
        const page = await browser.newPage(); await page.setUserAgent(agent);
        await page.goto(`${origin}/download/`, { waitUntil: 'networkidle0' });
        assert.equal(await page.$eval('[data-download-status]', el => el.textContent), '请在浏览器中打开');
        await page.click('[data-download-apk]');
        assert.equal(page.url(), `${origin}/download/`);
        await page.screenshot({ path: join(root, `${agent.startsWith('QQ') ? 'qq' : 'wechat'}.png`), fullPage: true });
        await page.close();
    }
    await writeFile(join(root, 'results.json'), JSON.stringify({ browser: await browser.version(), source: apk, evidence }, null, 2));
    console.log(JSON.stringify({ passed: true, cases: ['N=1', 'N=3', 'corrupt part', 'WeChat', 'QQ'], bytes: source.length, sha256: hash(source), output: root }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
