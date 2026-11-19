import { getImage } from 'astro:assets';
import type { CollectionEntry, CollectionKey } from 'astro:content';
import type { ImageMetadata } from 'astro';
import { posix } from 'node:path';
import { articleHtml } from './article-html.mjs';

// Every picture an article may show, made into optimized files by the build: its own, and the product screenshots the
// README shows too.
const pictures = import.meta.glob<{ default: ImageMetadata }>(['/src/content/**/*.{png,jpg,jpeg,webp,gif}', '/README.assets/*.{png,jpg,jpeg,webp,gif}'], { eager: true });

/** An article's body as HTML, its pictures resolved against where the article sits and offered at several widths. */
export async function renderArticle(entry: CollectionEntry<CollectionKey>): Promise<string> {
  const folder = posix.dirname('/' + (entry.filePath ?? ''));
  return articleHtml(entry.body ?? '', async (src: string) => {
    if (/^[a-z]+:|^\/\//i.test(src)) return undefined;
    const found = pictures[posix.normalize(posix.join(folder, decodeURI(src)))];
    if (!found) throw new Error(`An article picture is missing: ${src} in ${entry.filePath}`);
    const { width, height } = found.default;
    const shown = Math.min(width, 720);
    const largest = Math.min(width, 1440);
    const widths = [...new Set([400, 720, 1080, 1440].filter((size) => size < largest).concat(largest))];
    const sizes = `(max-width: 680px) min(${shown}px, calc(100vw - 40px)), (max-width: 784px) min(${shown}px, calc(100vw - 64px)), ${shown}px`;
    const made = await getImage({ src: found.default, width: shown, widths, sizes, quality: 80 });
    return { src: made.src, srcset: made.srcSet.attribute, sizes, width: shown, height: Math.round(height * shown / width), portrait: height > width * 1.25 };
  });
}
