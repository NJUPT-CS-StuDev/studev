import assert from 'node:assert/strict';
import test from 'node:test';
import { articleHtml } from '../article-html.mjs';

test('Typora inline extensions and code spans', async () => {
  const page = await articleHtml('==重点== H~2~O x^2^ `==原样==`');
  assert.match(page, /<mark>重点<\/mark>/);
  assert.match(page, /H<sub>2<\/sub>O/);
  assert.match(page, /x<sup>2<\/sup>/);
  assert.match(page, /<code>==原样==<\/code>/);
});

test('every way of writing a formula is typeset', async () => {
  const page = await articleHtml('行内 $x^2$ 与 \\(y^2\\)。\n\n\\[z^2\\]\n\n$$w^2$$\n\n```math\na^2+b^2=c^2\n```');
  assert.equal((page.match(/class="math math-inline"/g) ?? []).length, 2);
  assert.equal((page.match(/class="math math-display"/g) ?? []).length, 3);
  assert.doesNotMatch(page, /data-language="math"/);
});

test('GitHub alerts and task lists', async () => {
  const page = await articleHtml('> [!NOTE]\n> 说明\n\n- [x] 完成');
  assert.match(page, /markdown-alert-note/);
  assert.match(page, /type="checkbox"/);
});

test('Mermaid is laid out as SVG at build time, boxes and bold labels included', async () => {
  const page = await articleHtml('```mermaid\nflowchart TD\n  subgraph S["阶段"]\n    A["<b>粗</b><br/>细"] --> B\n  end\n```');
  assert.match(page, /<figure class="diagram" style="--w:[\d.]+"><svg[^>]*role="img"><title>阶段 → 粗/);
  assert.match(page, /font-weight="600">粗<\/text>/);
  assert.doesNotMatch(page, /data-language="mermaid"|&lt;b&gt;/);
});

test('code is coloured in both themes', async () => {
  const page = await articleHtml('```js\nconst answer = 42;\n```');
  assert.match(page, /astro-code-themes github-light github-dark/);
  assert.match(page, /--shiki-dark/);
});

test('a picture with a line in italics becomes a figure, with the files the build made', async () => {
  const made = { src: '/_astro/a.webp', srcset: '/_astro/a-400.webp 400w', sizes: '720px', width: 720, height: 480 };
  const page = await articleHtml('![现场](./a.jpeg)\n*大会现场*\n\n正文\n\n![合影](./b.jpeg)\n\n*合影留念*', async () => made);
  assert.equal((page.match(/<figure class="article-figure">/g) ?? []).length, 2);
  assert.match(page, /<figcaption>大会现场<\/figcaption>/);
  assert.match(page, /<figcaption>合影留念<\/figcaption>/);
  assert.match(page, /srcset="\/_astro\/a-400.webp 400w"[^>]*width="720" height="480" alt="现场" loading="eager" fetchpriority="high"/);
  assert.match(page, /alt="合影" loading="lazy"/);
});

test('raw HTML in an article is shown as written, never run', async () => {
  const page = await articleHtml('按 <kbd>Star</kbd> <script>alert(1)</script>');
  assert.doesNotMatch(page, /<script>|<kbd>/);
});
