// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://studev.hicancan.top',
  output: 'static',
  redirects: {
    '/explore': '/study',
    '/explore/00-access': '/study',
    '/explore/01-git-history': '/study/first-star',
    '/projects': '/develop',
    '/study/ai-learning': '/study',
    '/study/git-commits': '/study/first-star',
    '/study/network-access': '/study',
    '/study/search-practice': '/study',
    '/study/web-pages': '/study',
  },
});
