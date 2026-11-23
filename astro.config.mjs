// @ts-check
import { defineConfig } from 'astro/config';
import product from './product.json' with { type: 'json' };
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import localFonts from './src/site/build/local-fonts.mjs';
import webTokens from './src/site/build/web-tokens.mjs';
import searchPreload from './src/site/build/search-preload.mjs';
import { copyFile, readdir, rm } from 'node:fs/promises';

const excludedSitemapPaths = new Set([
  '/404',
  '/login',
  '/signed-in',
  '/account',
  '/members',
  '/forms',
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
  integrations: [react(), webTokens(), searchPreload(), localFonts(), {
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
});
