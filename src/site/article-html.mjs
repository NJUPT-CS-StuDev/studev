// An article drawn by docstream, the document kernel StuDev's web, apps and AI share with the blog: one reading of
// Markdown, its formulas typeset and Mermaid diagrams laid out as SVG at build time, nothing left for the browser to
// do. What the kernel leaves to the page is finished here: code coloured by Shiki in both themes, pictures given the
// files the build made of them, and a picture followed by a line in italics shown as a figure with that caption.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createShikiHighlighter } from '@astrojs/markdown-remark/shiki';
import { html, initialize } from 'docstream';

export const shikiThemes = { light: 'github-light', dark: 'github-dark' };

let ready;
/** The kernel and the highlighter, loaded once for the whole build. */
export function prepare() {
  ready ??= Promise.all([
    initialize(readFileSync(createRequire(import.meta.url).resolve('docstream/docstream_wasm_bg.wasm'))),
    createShikiHighlighter({ themes: shikiThemes }),
  ]).then(([, highlighter]) => highlighter);
  return ready;
}

const unescape = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** @typedef {{ src: string, srcset: string, sizes: string, width: number, height: number, portrait?: boolean }} Picture */

/**
 * Markdown drawn as an article's HTML. `image(src)` gives what a picture written as `src` is published as, or nothing
 * to keep it as written.
 * @param {string} markdown
 * @param {(src: string) => Promise<Picture | undefined>} [image]
 * @returns {Promise<string>}
 */
export async function articleHtml(markdown, image = async () => undefined) {
  const highlighter = await prepare();
  let page = html(markdown);
  // Code in the page's own colours, light and dark.
  const blocks = [...page.matchAll(/<pre data-language="([^"]*)"><code>([\s\S]*?)<\/code><\/pre>/g)];
  const coloured = await Promise.all(blocks.map(async ([, language, code]) => {
    const text = unescape(code);
    try { return await highlighter.codeToHtml(text, language || 'plaintext'); }
    catch { return await highlighter.codeToHtml(text, 'plaintext'); }
  }));
  blocks.forEach(([whole], at) => { page = page.replace(whole, () => coloured[at]); });
  // A diagram fits the column, but not below 72% of its size, where its words would be too small: wider, it scrolls.
  page = page.replace(/<figure class="diagram">(<svg[^>]*\bwidth="([\d.]+)")/g, (_, svg, width) => `<figure class="diagram" style="--w:${width}">${svg}`);
  // A picture alone in its paragraph, with a line in italics after it (in the paragraph or the next), is a figure.
  page = page.replace(/<p>(<img [^>]*>)(?:\n<em>([\s\S]*?)<\/em>)?<\/p>(?:\n<p><em>([\s\S]*?)<\/em><\/p>)?/g, (_, img, inline, next) => {
    const caption = inline ?? next;
    return caption === undefined ? `<p>${img}</p>` : `<figure class="article-figure">${img}<figcaption>${caption}</figcaption></figure>`;
  });
  // Pictures as the build made them; the first one is fetched first when the article opens with it.
  const opensWithPicture = /^<(?:figure class="article-figure"|p)><img /.test(page);
  const pictures = [...page.matchAll(/<img src="([^"]+)" alt="([^"]*)" loading="lazy">/g)];
  let first = true;
  for (const [whole, src, alt] of pictures) {
    const made = await image(unescape(src));
    const eager = first && opensWithPicture;
    first = false;
    if (!made) continue;
    const loading = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    const tag = `<img src="${attribute(made.src)}" srcset="${attribute(made.srcset)}" sizes="${attribute(made.sizes)}" width="${made.width}" height="${made.height}" alt="${alt}" ${loading} decoding="async" class="article-image${made.portrait ? ' article-image-portrait' : ''}">`;
    page = page.replace(whole, () => tag);
  }
  return page;
}
