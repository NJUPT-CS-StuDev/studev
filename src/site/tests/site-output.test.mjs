import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'parse5';
import test from 'node:test';

const output = resolve('dist');
// Paths answered by cloud functions rather than built pages: /api/ and every catch-all under cloud-functions/.
// Paths answered by something other than a built file: a cloud function, or a redirect in edgeone.json.
const redirected = (JSON.parse(await readFile('edgeone.json', 'utf8')).redirects ?? []).map((rule) => rule.source.replace(/\*$/, ''));
const served = ['/api/', ...redirected, ...(await readdir('cloud-functions', { recursive: true })).filter((file) => file.endsWith('[[path]].js')).map((file) => `/${dirname(file).replaceAll('\\', '/')}/`)];
async function pages(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'data') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await pages(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

const walk = (node, fn) => { fn(node); node.childNodes?.forEach((child) => walk(child, fn)); };
const attributes = (node) => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));

test('download links name immutable packages without depending on a weekly site rebuild', async () => {
  const product = JSON.parse(await readFile('product.json', 'utf8'));
  const hrefs = [];
  walk(parse(await readFile(join(output, 'download/index.html'), 'utf8')), node => {
    if (node.tagName === 'a') hrefs.push(attributes(node).href);
  });
  assert.deepEqual(hrefs.filter(href => href?.startsWith(`${product.downloadOrigin}/windows/`)),
    [`${product.downloadOrigin}/windows/studev-${product.android.versionName}-windows.zip`]);
  assert.ok(hrefs.includes(`${product.downloadOrigin}/studev-${product.android.versionName}.apk`));
  assert.ok(hrefs.every(href => !href?.includes('X-Amz-Expires=')), 'public releases have no expiring build-time download signature');
});

const localFile = (url, document) => {
  if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) return null;
  const pathname = decodeURI(url.split(/[?#]/)[0]);
  const path = pathname.startsWith('/') ? join(output, pathname.slice(1)) : resolve(dirname(document), pathname);
  return pathname.endsWith('/') ? join(path, 'index.html') : path;
};

test('every built page has valid local links and complete rendering', async () => {
  const files = await pages(output);
  let diagrams = 0;
  let captions = 0;
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    // Every diagram and formula drawn at build time; nothing written in an article shown as raw markup.
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net|data-language="(?:mermaid|math)"|class="raw-html"/, file);
    assert.match(html, /data-local-fonts/, file);
    assert.match(html, /rel="canonical"/, file);
    walk(parse(html), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'a') {
        const target = served.some((prefix) => attr.href?.startsWith(prefix)) ? null : localFile(attr.href, file);
        if (target) assert.ok(existsSync(target), `${file}: broken link ${attr.href}`);
      }
      if (node.tagName === 'img') {
        const target = localFile(attr.src, file);
        if (target) {
          assert.ok(existsSync(target), `${file}: missing image ${attr.src}`);
          assert.ok(attr.srcset, `${file}: missing responsive image candidates`);
          for (const candidate of attr.srcset.split(',')) {
            const asset = localFile(candidate.trim().split(/\s+/)[0], file);
            if (asset) assert.ok(existsSync(asset), `${file}: missing image candidate`);
          }
        }
        assert.ok(Number(attr.width) > 0 && Number(attr.height) > 0, `${file}: unreserved image layout`);
        assert.ok('alt' in attr, `${file}: missing alt`);
      }
      if (node.tagName === 'figcaption') captions++;
      if (node.tagName === 'figure' && attr.class === 'diagram') {
        diagrams++;
        const svg = node.childNodes.find((child) => child.tagName === 'svg');
        const title = svg?.childNodes.find((child) => child.tagName === 'title')?.childNodes[0]?.value ?? '';
        assert.ok(attributes(svg ?? {}).role === 'img' && title && !/^(?:flowchart|graph|sequenceDiagram|stateDiagram|quadrantChart)\b/.test(title), `${file}: diagram needs a meaningful name, not ${title}`);
      }
    });
  }
  assert.ok(diagrams > 0, 'the site must contain its pre-rendered diagrams');
  assert.ok(captions > 50, 'captions must remain attached to their pictures');
});

test('the first page starts light: the timetable loads itself after the shell', async () => {
  const html = await readFile(join(output, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => localFile(match[1], join(output, 'index.html')));
  const size = (await Promise.all(scripts.map(async (path) => (await stat(path)).size))).reduce((sum, bytes) => sum + bytes, 0);
  assert.ok(size < 40_000, `initial JavaScript is ${size} bytes`);
  assert.ok(!existsSync(join(output, 'logo.png')), 'full logo original must not be distributed');
});

test('knowledge starts with a published catalogue and refreshes from the independent snapshot', async () => {
  const html = await readFile(join(output, 'knowledge/index.html'), 'utf8');
  assert.match(html, /<h1[^>]*>知识<\/h1>/);
  assert.doesNotMatch(html, /role="status"[^>]*>正在加载课程/);
  let courses = 0;
  walk(parse(html), node => {
    if (node.attrs?.some(attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes('kn-course'))) courses++;
  });
  assert.ok(courses > 0, 'the first HTML includes real courses before JavaScript or a network refresh');
  for (const name of ['data', 'space', 'texts']) assert.ok(!existsSync(join(output, name)), `${name} belongs to the independent data publication`);
  const files = await readdir(join(output, '_astro'));
  const scripts = await Promise.all(files.filter(name => name.endsWith('.js')).map(name => readFile(join(output, '_astro', name), 'utf8')));
  assert.ok(scripts.some(text => text.includes('knowledge-catalog.json')), 'the live catalogue loader must be bundled');
});

test('article metadata and Markdown emphasis remain correct', async () => {
  const firstStar = await readFile(join(output, 'study/guide-first-star/index.html'), 'utf8');
  assert.match(firstStar, /2026-09-23/);
  for (const slug of ['essay-cyber-prison-sbti', 'journey-volunteer-teaching']) {
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

test('homepage recruitment entry respects recruitment toggle', async () => {
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
  if (group) {
    assert.equal(group, '1097757336');
    assert.equal(qrImages.length, 2);
    assert.ok(qrImages.every((attr) => attr.width === attr.height && attr.srcset));
    assert.equal(dialog['aria-labelledby'], 'qr-dialog-title');
    assert.equal(qrLink['aria-controls'], 'recruitment-dialog');
    assert.ok(existsSync(localFile(qrLink.href, join(output, 'index.html'))));
  } else {
    assert.equal(qrImages.length, 0);
  }
});

test('a page shares StuDev at most once, and keeps a clean canonical URL', async () => {
  for (const file of await pages(output)) {
    const html = await readFile(file, 'utf8');
    let canonical;
    const shared = [];
    walk(parse(html), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'link' && attr.rel === 'canonical') canonical = attr.href;
      if (node.tagName === 'button' && 'data-copy-link' in attr) {
        assert.equal(attr.type, 'button');
        shared.push(attr['data-copy-text']);
      }
    });
    // Sharing lives where one decides to pass StuDev on (the download page), at most once, and only ever StuDev's own address.
    assert.ok(shared.length <= 1, `${file}: at most one share action`);
    for (const value of shared) assert.ok(value.startsWith('https://studev.hicancan.top/'), `${file}: shares StuDev itself`);
    const url = new URL(canonical);
    assert.equal(url.origin, 'https://studev.hicancan.top');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
});

test('sitemap lists every unique indexable canonical page on the formal domain', async () => {
  const expected = new Set();
  for (const file of await pages(output)) {
    let canonical;
    let noindex = false;
    walk(parse(await readFile(file, 'utf8')), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'link' && attr.rel === 'canonical') canonical = attr.href;
      if (node.tagName === 'meta' && attr.name === 'robots' && attr.content.includes('noindex')) noindex = true;
    });
    if (!noindex) expected.add(canonical);
  }

  const index = await readFile(join(output, 'sitemap-index.xml'), 'utf8');
  const indexUrls = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(indexUrls, ['https://studev.hicancan.top/sitemap-0.xml']);

  const sitemap = await readFile(join(output, 'sitemap-0.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
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

test('error and all private platform pages stay outside search indexes', async () => {
  const privatePages = new Set(['404.html', ...['submit', 'admin', 'login', 'signed-in', 'account', 'members', 'forms', 'fill', 'submissions'].map((path) => `${path}/index.html`)].map((path) => join(output, path)));
  for (const file of await pages(output)) {
    let robots;
    walk(parse(await readFile(file, 'utf8')), (node) => {
      const attr = attributes(node);
      if (node.tagName === 'meta' && attr.name === 'robots') robots = attr.content;
    });
    if (privatePages.has(file)) assert.equal(robots, 'noindex');
    else assert.ok(!robots?.includes('noindex'), `${file}: a content page must remain indexable`);
  }
});

test('homepage exposes the Baidu and Bing ownership verifications in its head', async () => {
  const html = await readFile(join(output, 'index.html'), 'utf8');
  const verifications = {};
  walk(parse(html), (node) => {
    const attr = attributes(node);
    if (node.tagName === 'meta' && ['baidu-site-verification', 'msvalidate.01'].includes(attr.name)) {
      assert.equal(node.parentNode.tagName, 'head');
      verifications[attr.name] = attr.content;
    }
  });
  assert.equal(verifications['baidu-site-verification'], 'codeva-J4MgSBcNRe');
  assert.equal(verifications['msvalidate.01'], 'E44C2F6A09F0A678DED98C8374E549A1');
});

test('stable sitemap files revalidate without changing other asset headers', async () => {
  assert.ok(existsSync('edgeone.json'), 'EdgeOne reads its configuration from the project root');
  assert.ok(existsSync(join(output, 'edgeone.json')), 'raw dist deployment must include the cache policy');
  assert.ok(!existsSync('public/edgeone.json'), 'keep a single source for deployment configuration');
  const sourceConfig = await readFile('edgeone.json', 'utf8');
  const builtConfig = await readFile(join(output, 'edgeone.json'), 'utf8');
  assert.equal(builtConfig, sourceConfig, 'Astro must copy the deployment configuration unchanged');
  const config = JSON.parse(builtConfig);
  const sitemap = config.headers.find((rule) => rule.source === '/sitemap-*.xml');
  assert.ok(sitemap, 'cache policy must apply to the index and all sitemap chunks');
  const cache = sitemap.headers.find((header) => header.key.toLowerCase() === 'cache-control')?.value;
  assert.match(cache, /(?:^|,\s*)max-age=0(?:,|$)/);
  assert.match(cache, /(?:^|,\s*)must-revalidate(?:,|$)/);
  assert.doesNotMatch(cache, /immutable/);
  const cacheRules = config.headers.filter((rule) => rule.headers.some((header) => header.key.toLowerCase() === 'cache-control'));
  assert.ok(cacheRules.every((rule) => ['/sitemap-*.xml', '/_astro/*', '/sw.js', '/app-release.json'].includes(rule.source)), 'only sitemaps, app metadata/workers and versioned shell assets may receive a cache override');
});
