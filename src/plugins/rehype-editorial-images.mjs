import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const metadataCache = new Map();
const text = (node) => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
const significant = (nodes) => nodes.filter((node) => node.type !== 'text' || node.value.trim());

/** Keep portable Markdown images, adding responsive assets and semantic captions on the web. */
export default function rehypeEditorialImages() {
  return async (tree, file) => {
    const images = [];
    function collect(node) {
      if (node.type === 'element' && node.tagName === 'img') images.push(node);
      node.children?.forEach(collect);
    }
    collect(tree);
    for (const image of images) {
      const src = image.properties?.src;
      if (!file.path || typeof src !== 'string' || /^(?:[a-z]+:|\/|#)/i.test(src)) continue;
      const path = resolve(dirname(file.path), decodeURI(src));
      if (!metadataCache.has(path)) metadataCache.set(path, sharp(path).metadata());
      const { width, height } = await metadataCache.get(path);
      if (!width || !height) continue;
      const displayWidth = Math.min(width, 720);
      const largest = Math.min(width, 1440);
      image.properties = {
        ...image.properties,
        width: displayWidth,
        widths: [...new Set([400, 720, 1080, 1440].filter((size) => size < largest).concat(largest))],
        sizes: `(max-width: 680px) min(${displayWidth}px, calc(100vw - 40px)), (max-width: 784px) min(${displayWidth}px, calc(100vw - 64px)), ${displayWidth}px`,
        quality: 80,
        loading: 'lazy',
        decoding: 'async',
        className: height > width * 1.25 ? ['article-image', 'article-image-portrait'] : ['article-image'],
      };
    }

    function captions(parent) {
      if (!parent.children) return;
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        if (node.type === 'element' && node.tagName === 'p') {
          const children = significant(node.children);
          const image = children[0];
          if (image?.tagName === 'img' && children.length <= 2) {
            let caption = children[1]?.tagName === 'em' ? children[1] : undefined;
            if (!caption && children.length === 1) {
              let next = index + 1;
              while (parent.children[next]?.type === 'text' && !parent.children[next].value.trim()) next++;
              const sibling = parent.children[next];
              const content = sibling?.tagName === 'p' ? significant(sibling.children) : [];
              if (content.length === 1 && content[0].tagName === 'em') {
                caption = content[0];
                parent.children.splice(index + 1, next - index);
              }
            }
            if (caption) {
              node.tagName = 'figure';
              node.properties = { className: ['article-figure'] };
              node.children = [image, { type: 'element', tagName: 'figcaption', properties: {}, children: caption.children }];
            }
          }
        }
        captions(node);
      }
    }
    captions(tree);
    // Only prioritize an image when it is actually the first block of the article.
    const first = significant(tree.children)[0];
    if (first?.tagName === 'figure' || first?.tagName === 'p') {
      const firstImage = first.children?.find((node) => node.tagName === 'img');
      if (firstImage && (first.tagName === 'figure' || !text(first).trim())) {
        firstImage.properties.loading = 'eager';
        firstImage.properties.fetchpriority = 'high';
      }
    }
  };
}
