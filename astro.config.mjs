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
import remarkTyporaInline from './src/markdown/remark-typora-inline.mjs';
import rehypeEditorialImages from './src/markdown/rehype-editorial-images.mjs';
import rehypeStaticMermaid from './src/markdown/rehype-static-mermaid.mjs';
import localFonts from './src/astro/local-fonts.mjs';
import webTokens from './src/astro/web-tokens.mjs';
import { copyFile } from 'node:fs/promises';

const excludedSitemapPaths = new Set([
  '/404',
  '/submit',
  '/admin',
  '/login',
  '/account',
  '/forms',
  '/fill',
  '/submissions',
  '/legacy-collection',
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
    hooks: { 'astro:build:done': ({ dir }) => copyFile('edgeone.json', new URL('edgeone.json', dir)) },
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
