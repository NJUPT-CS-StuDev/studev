// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://studev.hicancan.top',
  output: 'static',
  redirects: {
    '/explore': '/study',
    '/explore/00-access': '/study/web-pages',
    '/explore/01-git-history': '/study/git-commits',
    '/projects': '/',
  },
});
