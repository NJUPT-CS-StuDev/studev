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
    if ('data-copy-group' in attr) group = attr['data-copy-text'];
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

test('every page can share its clean canonical URL', async () => {
  for (const file of await pages(output)) {
    const html = await readFile(file, 'utf8');
    let canonical;
    let shares = 0;
    walk(parse(html), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'link' && attr.rel === 'canonical') canonical = attr.href;
      if (node.tagName === 'button' && 'data-copy-link' in attr) {
        shares++;
        assert.equal(attr.type, 'button');
      }
    });
    assert.ok(shares > 0, `${file}: missing share action`);
    const url = new URL(canonical);
    assert.equal(url.origin, 'https://studev.hicancan.top');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    if (file === join(output, 'index.html')) assert.equal(shares, 2);
    else assert.match(html, /分享本页/);
  }
});

test('sitemap lists every unique indexable canonical page on the formal domain', async () => {
  const expected = new Set();
  for (const file of await pages(output)) {
    if (file === join(output, '404.html')) continue;
    walk(parse(await readFile(file, 'utf8')), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'link' && attr.rel === 'canonical') expected.add(attr.href);
    });
  }

  const index = await readFile(join(output, 'sitemap-index.xml'), 'utf8');
  const indexUrls = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(indexUrls, ['https://studev.hicancan.top/sitemap-0.xml']);

  const sitemap = await readFile(join(output, 'sitemap-0.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(urls.length, 23);
  assert.equal(new Set(urls).size, urls.length, 'sitemap must not contain duplicate URLs');
  assert.deepEqual([...urls].sort(), [...expected].sort(), 'sitemap must match indexable canonical URLs');
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.origin, 'https://studev.hicancan.top');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.doesNotMatch(url.pathname, /^\/(?:404\/?|life\/(?:organizational-genesis|anti-formalism-council)\/?)$/);
  }
});

test('robots and HTML advertise the formal sitemap', async () => {
  const sitemapUrl = 'https://studev.hicancan.top/sitemap-index.xml';
  const robots = await readFile(join(output, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(robots.includes(`Sitemap: ${sitemapUrl}`));
  assert.doesNotMatch(robots, /^Disallow: \//m);
  for (const file of await pages(output)) {
    let discovery;
    walk(parse(await readFile(file, 'utf8')), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'link' && attr.rel === 'sitemap') discovery = attr;
    });
    assert.equal(discovery?.href, sitemapUrl, `${file}: missing sitemap discovery`);
    assert.equal(discovery?.type, 'application/xml');
  }
});

test('only the error page declares noindex', async () => {
  for (const file of await pages(output)) {
    let robots;
    walk(parse(await readFile(file, 'utf8')), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'meta' && attr.name === 'robots') robots = attr.content;
    });
    if (file === join(output, '404.html')) assert.equal(robots, 'noindex');
    else assert.ok(!robots?.includes('noindex'), `${file}: a content page must remain indexable`);
  }
});
