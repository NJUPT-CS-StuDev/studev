import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math-extended';
import remarkGfm from 'remark-gfm';
import rehypeMathjax from 'rehype-mathjax/svg';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { rehypeGithubAlerts } from 'rehype-github-alerts';
import remarkTyporaInline from '../src/plugins/remark-typora-inline.mjs';

const markdown = await createMarkdownProcessor({
  gfm: false,
  remarkPlugins: [[remarkGfm, { singleTilde: false }], remarkMath, remarkTyporaInline],
  rehypePlugins: [[rehypeMathjax, { tex: { packages: [...AllPackages, 'physics'] } }], rehypeGithubAlerts],
});

test('Typora inline extensions and fenced code', async () => {
  const { code } = await markdown.render('==重点== H~2~O x^2^ `==原样==`');
  assert.match(code, /<mark>重点<\/mark>/);
  assert.match(code, /H<sub>2<\/sub>O/);
  assert.match(code, /x<sup>2<\/sup>/);
  assert.match(code, /<code>==原样==<\/code>/);
});

test('math delimiters and fenced math', async () => {
  const { code } = await markdown.render('行内 $x^2$ 与 \\(y^2\\)。\n\n\\[z^2\\]\n\n```math\na^2+b^2=c^2\n```');
  assert.equal((code.match(/<mjx-container/g) ?? []).length, 4);
});

test('MathJax physics notation', async () => {
  const { code } = await markdown.render('$\\dv{x}{t}$');
  assert.match(code, /<mjx-container/);
  assert.doesNotMatch(code, /<g data-mml-node="mtext" fill="red"|Undefined control sequence/);
});

test('GitHub alerts and GFM task lists', async () => {
  const { code } = await markdown.render('> [!NOTE]\n> 说明\n\n- [x] 完成');
  assert.match(code, /markdown-alert-note/);
  assert.match(code, /type="checkbox"/);
});
