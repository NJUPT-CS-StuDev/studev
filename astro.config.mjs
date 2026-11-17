// @ts-check
import { defineConfig } from 'astro/config';
import product from './product.json' with { type: 'json' };
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math-extended';
import remarkGfm from 'remark-gfm';
import rehypeMathjax from 'rehype-mathjax/svg';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { rehypeGithubAlerts } from 'rehype-github-alerts';
import remarkTyporaInline from './src/site/markdown/remark-typora-inline.mjs';
import rehypeEditorialImages from './src/site/markdown/rehype-editorial-images.mjs';
import rehypeStaticMermaid from './src/site/markdown/rehype-static-mermaid.mjs';
import localFonts from './src/site/build/local-fonts.mjs';
import webTokens from './src/site/build/web-tokens.mjs';
import { copyFile, readdir, rm } from 'node:fs/promises';

const excludedSitemapPaths = new Set([
  '/404',
  '/submit',
  '/admin',
  '/login',
  '/signed-in',
  '/account',
  '/members',
  '/forms',
  '/fill',
  '/submissions',
  '/life/organizational-genesis',
  '/life/anti-formalism-council',
]);

export default defineConfig({
  site: product.origin,
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [react(), webTokens(), localFonts(), {
    // EdgeOne reads edgeone.json from the project root; a copy beside the built
    // files covers deployments of the output directory alone.
    name: 'studev-edgeone-config',
    hooks: { 'astro:build:done': async ({ dir }) => {
      await copyFile('edgeone.json', new URL('edgeone.json', dir));
      // public/ also stages native bundles and independent campus components.
      // Only the application shell is deployed here. Keep generated page indexes
      // such as /knowledge/index.html while removing their public resource children.
      for (const name of ['data', 'space', 'texts']) await rm(new URL(name, dir), { recursive: true, force: true });
      for (const name of ['knowledge', 'search', 'map']) {
        let entries; try { entries = await readdir(`public/${name}`); } catch { continue; }
        for (const entry of entries) await rm(new URL(`${name}/${entry}`, dir), { recursive: true, force: true });
      }
    } },
  }, sitemap({
    filter: (page) => !excludedSitemapPaths.has(new URL(page).pathname.replace(/\/$/, '')),
  })],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      langAlias: { flow: 'plaintext', sequence: 'plaintext' },
    },
    processor: unified({
      gfm: false,
      remarkPlugins: [[remarkGfm, { singleTilde: false }], remarkMath, remarkTyporaInline],
      rehypePlugins: [[rehypeMathjax, { tex: { packages: [...AllPackages, 'physics'] } }], rehypeGithubAlerts, rehypeEditorialImages, rehypeStaticMermaid],
    }),
  },
});
