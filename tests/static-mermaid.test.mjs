import assert from 'node:assert/strict';
import process from 'node:process';
import test, { after } from 'node:test';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import rehypeStaticMermaid from '../src/plugins/rehype-static-mermaid.mjs';

const taskTempRoot = process.platform === 'win32' ? 'D:/Temp/codex/studev-audit' : join(tmpdir(), 'studev-audit');
const cacheDir = join(taskTempRoot, 'mermaid-test');
await mkdir(cacheDir, { recursive: true });
after(async () => {
  const resolvedRoot = resolve(taskTempRoot);
  const resolvedCache = resolve(cacheDir);
  assert.ok(resolvedCache.startsWith(`${resolvedRoot}${sep}`));
  await rm(resolvedCache, { recursive: true, force: true });
});
const fixtureURL = new URL('./fixtures/static-mermaid.md', import.meta.url);
const fixture = await readFile(fixtureURL, 'utf8');
const processor = await createMarkdownProcessor({ rehypePlugins: [[rehypeStaticMermaid, { cacheDir }]] });

test('Mermaid compiles into accessible dual-theme SVG with isolated IDs', async () => {
  const { code } = await processor.render(fixture, { fileURL: fixtureURL });
  assert.equal((code.match(/class="diagram-panel diagram-static"/g) ?? []).length, 3);
  assert.equal((code.match(/class="diagram-light"/g) ?? []).length, 3);
  assert.equal((code.match(/class="diagram-dark"/g) ?? []).length, 3);
  assert.equal((code.match(/<svg\b/g) ?? []).length, 6);
  assert.match(code, /role="img" aria-label="图表：学习 → 动手实践 → 分享成果"/);
  assert.match(code, /aria-label="图表：同学 → StuDev"/);
  assert.match(code, /#202124/);
  assert.match(code, /#e8edf3/);
  assert.match(code, /min-width:[\d.]+px/);
  assert.match(code, /const/);
  assert.doesNotMatch(code, /language-mermaid|data-language="mermaid"|Syntax error in text/);

  const ids = [...code.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'SVG IDs must be unique across repeated diagrams and themes');
  const references = [...code.matchAll(/url\(#([^)]+)\)|(?:href|xlink:href)="#([^"]+)"/g)].map((match) => match[1] ?? match[2]);
  assert.ok(references.length > 0);
  assert.ok(references.every((reference) => ids.includes(reference)), 'every local SVG reference must resolve');

  const files = await readdir(cacheDir);
  const before = await Promise.all(files.map(async (file) => (await stat(`${cacheDir}/${file}`)).mtimeMs));
  const second = await processor.render(fixture, { fileURL: fixtureURL });
  const after = await Promise.all(files.map(async (file) => (await stat(`${cacheDir}/${file}`)).mtimeMs));
  assert.equal(second.code, code, 'warm rendering must be deterministic');
  assert.deepEqual(after, before, 'warm rendering must reuse persisted SVG cache');
});

test('invalid Mermaid fails compilation instead of exposing unrendered source', async () => {
  const transform = rehypeStaticMermaid({ cacheDir });
  const tree = {
    type: 'root',
    children: [{
      type: 'element', tagName: 'pre', properties: {},
      children: [{
        type: 'element', tagName: 'code', properties: { className: ['language-mermaid'] },
        children: [{ type: 'text', value: 'flowchart LR\n  A --> [' }],
      }],
    }],
  };
  await assert.rejects(transform(tree, { path: 'invalid-mermaid.md' }), /Mermaid compilation failed in invalid-mermaid\.md/);
  assert.equal(tree.children[0].tagName, 'pre', 'a failing compilation cannot produce a partial diagram');
});
