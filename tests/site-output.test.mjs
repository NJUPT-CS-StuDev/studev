import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'parse5';
import test from 'node:test';

const output = resolve('dist');
async function pages(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await pages(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

const walk = (node, fn) => { fn(node); node.childNodes?.forEach((child) => walk(child, fn)); };
const attributes = (node) => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
const localFile = (url, document) => {
  if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) return null;
  const pathname = decodeURI(url.split(/[?#]/)[0]);
  const path = pathname.startsWith('/') ? join(output, pathname.slice(1)) : resolve(dirname(document), pathname);
  return pathname.endsWith('/') ? join(path, 'index.html') : path;
};

test('every built page has valid local links and complete rendering', async () => {
  const files = await pages(output);
  assert.equal(files.length, 26);
  let diagrams = 0;
  let captions = 0;
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net|Painting Diagram|data-language="mermaid"|Syntax error in text/, file);
    assert.match(html, /data-local-fonts/, file);
    assert.match(html, /rel="canonical"/, file);
    walk(parse(html), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'a') {
        const target = localFile(attr.href, file);
        if (target) assert.ok(existsSync(target), `${file}: broken link ${attr.href}`);
      }
      if (node.tagName === 'img') {
        const target = localFile(attr.src, file);
        if (target) assert.ok(existsSync(target), `${file}: missing image ${attr.src}`);
        assert.ok(Number(attr.width) > 0 && Number(attr.height) > 0, `${file}: unreserved image layout`);
        assert.ok('alt' in attr, `${file}: missing alt`);
        assert.ok(attr.srcset, `${file}: missing responsive image candidates`);
        for (const candidate of attr.srcset.split(',')) {
          const asset = localFile(candidate.trim().split(/\s+/)[0], file);
          if (asset) assert.ok(existsSync(asset), `${file}: missing image candidate`);
        }
      }
      if (node.tagName === 'figcaption') captions++;
      if (attr.class?.includes('diagram-static')) {
        diagrams++;
        assert.ok(attr['aria-label'] && attr['aria-label'] !== '图表', `${file}: diagram needs a meaningful label`);
      }
    });
  }
  assert.equal(diagrams, 33, 'every existing Mermaid fence must be pre-rendered');
  assert.ok(captions > 50, 'captions must remain attached to their pictures');
});

test('homepage ships a small local logo, fonts, and JavaScript', async () => {
  const html = await readFile(join(output, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => localFile(match[1], join(output, 'index.html')));
  const size = (await Promise.all(scripts.map(async (path) => (await stat(path)).size))).reduce((sum, bytes) => sum + bytes, 0);
  assert.ok(size < 12_000, `homepage initial JavaScript is ${size} bytes`);
  const fonts = [...html.matchAll(/<link data-local-font-preload[^>]+href="([^"]+)"/g)].map((match) => localFile(match[1], join(output, 'index.html')));
  const fontSize = (await Promise.all(fonts.map(async (path) => (await stat(path)).size))).reduce((sum, bytes) => sum + bytes, 0);
  assert.ok(fontSize > 0 && fontSize < 50_000, `homepage fonts are ${fontSize} bytes`);
  const logo = html.match(/<img[^>]+src="([^"]+)"/);
  assert.ok((await stat(localFile(logo[1], join(output, 'index.html')))).size < 5_000);
  assert.ok(!existsSync(join(output, 'logo.png')), 'full logo original must not be distributed');
});

test('article metadata and Markdown emphasis remain correct', async () => {
  const firstStar = await readFile(join(output, 'study/first-star/index.html'), 'utf8');
  assert.match(firstStar, /2026-09-23/);
  for (const slug of ['cyber-prison-sbti', 'peer-mentors-letter', 'volunteer-teaching-dream']) {
    const html = await readFile(join(output, `life/${slug}/index.html`), 'utf8');
    walk(parse(html), (node) => {
      if (node.nodeName === '#text' && node.value.includes('**')) {
        let parent = node.parentNode;
        let code = false;
        while (parent) { if (parent.tagName === 'code' || parent.tagName === 'pre' || parent.tagName === 'script') code = true; parent = parent.parentNode; }
        if (!code) assert.fail(`${slug}: literal emphasis marker ${node.value.slice(0, 100)}`);
      }
    });
  }
});

test('homepage recruitment entry keeps the group number and a square QR enlargement', async () => {
  const html = await readFile(join(output, 'index.html'), 'utf8');
  const qrImages = [];
  let dialog;
  let group;
  let qrLink;
  walk(parse(html), (node) => {
    const attr = attributes(node);
    if (node.tagName === 'dialog' && attr.id === 'recruitment-dialog') dialog = attr;
    if (attr['data-copy-group']) group = attr['data-copy-group'];
    if ('data-qr-open' in attr) qrLink = attr;
    if (node.tagName === 'img' && attr.alt?.includes('招新')) qrImages.push(attr);
  });
  assert.equal(group, '1097757336');
  assert.equal(qrImages.length, 2);
  assert.ok(qrImages.every((attr) => attr.width === attr.height && attr.srcset));
  assert.equal(dialog['aria-labelledby'], 'qr-dialog-title');
  assert.equal(qrLink['aria-controls'], 'recruitment-dialog');
  assert.ok(existsSync(localFile(qrLink.href, join(output, 'index.html'))));
});
