import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import subsetFont from 'subset-font';

const source = new URL('../assets/fonts/WenKaiGBScreen-v1.522.woff2', import.meta.url);
const license = new URL('../assets/fonts/OFL.txt', import.meta.url);
const family = 'StuDev WenKai';
const excluded = new Set(['head', 'script', 'style', 'noscript', 'pre', 'code', 'svg', 'mjx-container']);

function characters(text) {
  return new Set([...text.replace(/\s+/gu, ' ')]);
}

function phraseText(code) {
  let text = '';
  for (const match of code.matchAll(/(?:const|let)\s+phrases\s*=\s*\[([\s\S]*?)\]/g)) {
    for (const string of match[1].matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      text += string[2].replace(/\\(['"\\])/g, '$1');
    }
  }
  return text;
}

export function visibleCharacters(html, extraText = '') {
  let text = extraText;
  function visit(node) {
    if (excluded.has(node.tagName)) return;
    if (node.nodeName === '#text') text += node.value;
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));

  text += phraseText(html);
  return characters(text);
}

function sortedText(values) {
  return [...values].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
}

function unicodeRange(values) {
  const codes = [...values].map((character) => character.codePointAt(0)).sort((a, b) => a - b);
  const ranges = [];
  for (let index = 0; index < codes.length; index++) {
    const first = codes[index];
    let last = first;
    while (codes[index + 1] === last + 1) last = codes[++index];
    ranges.push(`U+${first.toString(16)}${last === first ? '' : `-${last.toString(16)}`}`);
  }
  return ranges.join(',');
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

export async function subsetBuiltFonts(directory, { base = '/', log = () => {} } = {}) {
  const files = await htmlFiles(directory);
  // Read the source before bundling renames the array or moves it into a JS asset.
  const homepagePhrases = phraseText(await readFile(new URL('../client/site/typewriter.ts', import.meta.url), 'utf8'));
  const pages = await Promise.all(files.map(async (path) => {
    const html = await readFile(path, 'utf8');
    const extra = path === join(directory, 'index.html') ? homepagePhrases : '';
    return { path, html, characters: visibleCharacters(html, extra) };
  }));
  if (!pages.length) return [];

  const common = new Set(pages[0].characters);
  for (const page of pages.slice(1)) {
    for (const character of common) if (!page.characters.has(character)) common.delete(character);
  }
  const font = await readFile(source);
  const output = join(directory, '_astro');
  await mkdir(output, { recursive: true });
  const cache = new Map();

  async function emit(values, label) {
    const text = sortedText(values);
    if (!text) return null;
    if (cache.has(text)) return cache.get(text);
    const subset = await subsetFont(font, text, {
      targetFormat: 'woff2', preserveNameIds: [0, 13, 14],
    });
    const hash = createHash('sha256').update(subset).digest('hex').slice(0, 12);
    const name = `wenkai-${label}.${hash}.woff2`;
    await writeFile(join(output, name), subset);
    const href = `${base.replace(/\/$/, '')}/_astro/${name}`;
    const face = `@font-face{font-family:"${family}";font-style:normal;font-weight:400;font-display:swap;src:url("${href}") format("woff2");unicode-range:${unicodeRange(values)}}`;
    const result = { href, face, bytes: subset.length, glyphs: values.size };
    cache.set(text, result);
    return result;
  }

  const shared = await emit(common, 'shared');
  const results = [];
  for (const page of pages) {
    const own = new Set([...page.characters].filter((character) => !common.has(character)));
    const subset = await emit(own, 'page');
    const fonts = [shared, subset].filter(Boolean);
    const preload = fonts.map(({ href }) => `<link data-local-font-preload rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`).join('');
    const styles = `<style data-local-fonts>${fonts.map(({ face }) => face).join('')}</style>`;
    const original = page.html.replace(/<link data-local-font-preload[^>]*>/g, '').replace(/<style data-local-fonts>[\s\S]*?<\/style>/g, '');
    await writeFile(page.path, original.replace('</head>', `${preload}${styles}</head>`));
    results.push({ page: relative(directory, page.path).replaceAll('\\', '/'), bytes: fonts.reduce((sum, item) => sum + item.bytes, 0), glyphs: page.characters.size });
  }
  await writeFile(join(output, 'wenkai-OFL.txt'), await readFile(license));
  log(`Local WenKai: ${results.length} pages, shared ${((shared?.bytes ?? 0) / 1024).toFixed(1)} KiB, homepage ${((results.find(({ page }) => page === 'index.html')?.bytes ?? 0) / 1024).toFixed(1)} KiB`);
  return results;
}

export default function localFonts() {
  let base = '/';
  return {
    name: 'studev-local-fonts',
    hooks: {
      'astro:config:done': ({ config }) => { base = config.base; },
      'astro:build:done': async ({ dir, logger }) => {
        await subsetBuiltFonts(fileURLToPath(dir), { base, log: (message) => logger.info(message) });
      },
    },
  };
}
